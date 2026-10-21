use async_trait::async_trait;
use futures_util::{StreamExt, stream};
use novelai_bridge::{
    CreditEvent, CreditObserver, RequestOutcome, StreamingTransport, Transport, TransportRequest,
    TransportResponse, TransportSseEvent, TransportSseResponse,
};

use super::*;

const PNG: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAC0lEQVR4nGNgQAcAABIAAXfx+gAAAAAASUVORK5CYII=";

struct MemoryTransport {
    events: Vec<TransportSseEvent>,
    eof: Option<Arc<Notify>>,
}

#[async_trait]
impl Transport for MemoryTransport {
    async fn execute(
        &self,
        _request: TransportRequest,
    ) -> Result<TransportResponse, novelai_bridge::TransportError> {
        panic!("streaming test must not make ordinary requests")
    }
}

#[async_trait]
impl StreamingTransport for MemoryTransport {
    async fn execute_sse(
        &self,
        _request: TransportRequest,
    ) -> Result<TransportSseResponse, novelai_bridge::TransportError> {
        let events = stream::iter(self.events.clone().into_iter().map(Ok));
        let eof = self.eof.clone();
        let tail = stream::unfold(eof, |gate| async move {
            if let Some(gate) = gate {
                gate.notified().await;
            }
            None::<(
                Result<TransportSseEvent, novelai_bridge::TransportError>,
                Option<Arc<Notify>>,
            )>
        });
        Ok(TransportSseResponse::Events(Box::pin(events.chain(tail))))
    }
}

#[derive(Default)]
struct MemoryObserver {
    outcomes: Mutex<Vec<RequestOutcome>>,
    changed: Notify,
}

#[async_trait]
impl CreditObserver for MemoryObserver {
    async fn observe(&self, event: CreditEvent) {
        if let CreditEvent::RequestSettled { outcome, .. } = event {
            self.outcomes.lock().unwrap().push(outcome);
            self.changed.notify_one();
        }
    }
}

struct MemoryClient(SdkClient);

impl SdkClientProvider for MemoryClient {
    fn client(&self) -> Result<SdkClient, JobError> { Ok(self.0.clone()) }

    fn cached_client(&self) -> Option<SdkClient> { Some(self.0.clone()) }
}

struct MemoryOutputs {
    jobs: Arc<MemoryJobs>,
    images: Mutex<Vec<usize>>,
}

impl FinalOutputStore for MemoryOutputs {
    fn retain(
        &self,
        job: &JobRecord,
        output: crate::media::JobOutput,
    ) -> Result<(), PersistenceError> {
        let crate::media::JobOutput::Generation(output) = output else {
            return Err(PersistenceError::InvalidData {
                message: "streaming test only retains generation".to_owned(),
            });
        };
        let mut records = self.jobs.records.lock().unwrap();
        let record = records
            .iter_mut()
            .find(|record| record.id == job.id)
            .unwrap();
        if record.status == JobStatus::Running {
            record.status = JobStatus::Completed;
            self.images.lock().unwrap().push(output.images.len());
        }
        self.jobs.changed.notify_one();
        Ok(())
    }
}

fn event(kind: &str) -> TransportSseEvent {
    let data = match kind {
        "final" => serde_json::json!({"samp_ix":0,"gen_id":1,"image":PNG}),
        "intermediate" => serde_json::json!({"samp_ix":0,"step_ix":2,"gen_id":1,"image":"preview"}),
        "error" => serde_json::json!({"samp_ix":0,"message":"private-provider-message"}),
        _ => unreachable!(),
    };
    TransportSseEvent {
        event: kind.to_owned(),
        data: data.to_string(),
        ..Default::default()
    }
}

fn streaming_queue(
    events: Vec<TransportSseEvent>,
    eof: Option<Arc<Notify>>,
) -> (
    Arc<JobQueue>,
    Arc<MemoryJobs>,
    Arc<MemoryOutputs>,
    Arc<MemoryObserver>,
) {
    let jobs = Arc::new(MemoryJobs::default());
    let outputs = Arc::new(MemoryOutputs {
        jobs: Arc::clone(&jobs),
        images: Mutex::new(Vec::new()),
    });
    let observer = Arc::new(MemoryObserver::default());
    let transport: Arc<dyn StreamingTransport> = Arc::new(MemoryTransport { events, eof });
    let client = novelai_bridge::Client::new(transport, novelai_bridge::ClientConfig::default())
        .with_credit_observer(Arc::<MemoryObserver>::clone(&observer));
    let queue = JobQueue::new(
        Arc::<MemoryJobs>::clone(&jobs),
        Arc::new(Resources {
            resource: Resource {
                id: "chunk".to_owned(),
                revision: 1,
                name: "chunk".to_owned(),
                content: ResourceContent::Chunk {
                    text: "a cat".to_owned(),
                },
            },
        }),
        Arc::<MemoryOutputs>::clone(&outputs),
        Arc::new(TestCredentials {
            configured: true,
            unexpected_call: Arc::new(AtomicBool::new(false)),
        }),
        Arc::new(NoAssets),
        Arc::new(MemoryClient(client)),
        Arc::new(Tokenizers::new()),
    )
    .unwrap();
    (queue, jobs, outputs, observer)
}

fn streamed_submission() -> FrozenSubmission {
    let mut frozen = submission();
    let FrozenSubmission::Generation { resolved, .. } = &mut frozen else {
        unreachable!()
    };
    resolved.inputs.stream = Some(novelai_bridge::StreamMode::Sse);
    frozen
}

async fn terminal(jobs: &MemoryJobs, id: &str) -> JobStatus {
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let changed = jobs.changed.notified();
            let status = jobs.get_job(id).unwrap().status;
            if matches!(
                status,
                JobStatus::Completed | JobStatus::Failed | JobStatus::Cancelled
            ) {
                return status;
            }
            changed.await;
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn final_event_is_not_completed_until_sdk_validates_eof() {
    let eof = Arc::new(Notify::new());
    let (queue, jobs, outputs, observer) = streaming_queue(
        vec![event("intermediate"), event("final")],
        Some(Arc::clone(&eof)),
    );
    let mut feedback = queue.subscribe();
    let job = queue.enqueue(&streamed_submission()).unwrap();
    let worker = tokio::spawn(Arc::clone(&queue).run());
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if matches!(
                feedback.recv().await.unwrap(),
                JobFeedback::FinalReceived { .. }
            ) {
                break;
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(jobs.get_job(&job.id).unwrap().status, JobStatus::Running);
    assert!(outputs.images.lock().unwrap().is_empty());
    assert!(observer.outcomes.lock().unwrap().is_empty());
    eof.notify_one();
    assert_eq!(terminal(&jobs, &job.id).await, JobStatus::Completed);
    assert_eq!(*outputs.images.lock().unwrap(), [1]);
    assert_eq!(
        *observer.outcomes.lock().unwrap(),
        [RequestOutcome::Succeeded { image_count: 1 }]
    );
    worker.abort();
    drop(worker.await);
}

#[tokio::test]
async fn incomplete_eof_and_error_after_final_do_not_retain_outputs() {
    for events in [
        vec![event("intermediate")],
        vec![event("final"), event("error")],
    ] {
        let (queue, jobs, outputs, observer) = streaming_queue(events, None);
        let job = queue.enqueue(&streamed_submission()).unwrap();
        let worker = tokio::spawn(Arc::clone(&queue).run());
        assert_eq!(terminal(&jobs, &job.id).await, JobStatus::Failed);
        assert!(outputs.images.lock().unwrap().is_empty());
        assert!(matches!(
            observer.outcomes.lock().unwrap().as_slice(),
            [RequestOutcome::Failed { .. }]
        ));
        assert!(
            !jobs
                .get_job(&job.id)
                .unwrap()
                .error
                .unwrap()
                .contains("private-provider-message")
        );
        worker.abort();
        drop(worker.await);
    }
}

#[tokio::test]
async fn active_cancel_awaits_sdk_observation_and_releases_the_queue() {
    let (queue, jobs, outputs, observer) =
        streaming_queue(vec![event("intermediate")], Some(Arc::new(Notify::new())));
    let mut feedback = queue.subscribe();
    let first = queue.enqueue(&streamed_submission()).unwrap();
    let worker = tokio::spawn(Arc::clone(&queue).run());
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if matches!(feedback.recv().await.unwrap(), JobFeedback::Preview { .. }) {
                break;
            }
        }
    })
    .await
    .unwrap();
    queue.cancel(&first.id).unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if matches!(feedback.recv().await.unwrap(), JobFeedback::Finished { .. }) {
                break;
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(
        *observer.outcomes.lock().unwrap(),
        [RequestOutcome::Cancelled]
    );
    assert!(outputs.images.lock().unwrap().is_empty());
    assert_eq!(
        jobs.get_job(&first.id).unwrap().status,
        JobStatus::Cancelled
    );
    worker.abort();
    drop(worker.await);
}

#[tokio::test]
async fn unavailable_frozen_input_fails_one_job_and_allows_the_next() {
    let (queue, jobs, outputs, _) = streaming_queue(vec![event("final")], None);
    let mut bad = streamed_submission();
    let FrozenSubmission::Generation { resolved, .. } = &mut bad else {
        unreachable!()
    };
    resolved.inputs.operation = crate::session::CreationOperation::ImageToImage {
        asset_id: "missing".to_owned(),
        strength: 0.5,
        noise: 0.1,
        color_correct: true,
        extra_noise_seed: None,
        add_original_image: true,
    };
    let first = queue.enqueue(&bad).unwrap();
    let second = queue.enqueue(&streamed_submission()).unwrap();
    let worker = tokio::spawn(Arc::clone(&queue).run());
    assert_eq!(terminal(&jobs, &second.id).await, JobStatus::Completed);
    assert_eq!(jobs.get_job(&first.id).unwrap().status, JobStatus::Failed);
    assert_eq!(*jobs.claimed.lock().unwrap(), [first.id, second.id]);
    assert_eq!(*outputs.images.lock().unwrap(), [1]);
    assert!(!queue.failed.load(Ordering::Acquire));
    worker.abort();
    drop(worker.await);
}
