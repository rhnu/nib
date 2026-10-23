use async_trait::async_trait;
use futures_util::{StreamExt, stream};
use novelai_bridge::{
    Transport, TransportHeader, TransportRequest, TransportResponse, TransportSseEvent,
};

use super::*;

const PNG: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAC0lEQVR4nGNgQAcAABIAAXfx+gAAAAAASUVORK5CYII=";

struct MemoryTransport {
    events: Vec<TransportSseEvent>,
    eof: Mutex<Option<Arc<Notify>>>,
}

#[async_trait]
impl Transport for MemoryTransport {
    async fn execute(
        &self,
        _request: TransportRequest,
    ) -> Result<TransportResponse, novelai_bridge::TransportError> {
        let events = stream::iter(self.events.clone().into_iter().map(|event| {
            Ok(format!("event: {}\ndata: {}\n\n", event.event, event.data).into_bytes())
        }));
        let eof = self.eof.lock().unwrap().take();
        let tail = stream::unfold(eof, |gate| async move {
            if let Some(gate) = gate {
                gate.notified().await;
            }
            None::<(
                Result<Vec<u8>, novelai_bridge::TransportError>,
                Option<Arc<Notify>>,
            )>
        });
        Ok(TransportResponse {
            status: 200,
            headers: vec![TransportHeader {
                name: "content-type".to_owned(),
                value: b"text/event-stream".to_vec(),
            }],
            body: Box::pin(events.chain(tail)),
        })
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
        let image_count = match output {
            crate::media::JobOutput::Generation(output) => output.images.len(),
            crate::media::JobOutput::Upscale(output) => output.images.len(),
            _ => {
                return Err(PersistenceError::InvalidData {
                    message: "image execution test only retains image collections".to_owned(),
                });
            },
        };
        let mut records = self.jobs.records.lock().unwrap();
        let record = records
            .iter_mut()
            .find(|record| record.id == job.id)
            .unwrap();
        if record.status == JobStatus::Running {
            record.status = JobStatus::Completed;
            self.images.lock().unwrap().push(image_count);
        }
        self.jobs.changed.notify_one();
        Ok(())
    }
}

fn event(kind: &str) -> TransportSseEvent {
    let data = match kind {
        "final" => serde_json::json!({"samp_ix":0,"gen_id":1,"image":PNG}),
        "intermediate" => serde_json::json!({"samp_ix":0,"step_ix":2,"gen_id":1,"image":PNG}),
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
) -> (Arc<JobQueue>, Arc<MemoryJobs>, Arc<MemoryOutputs>) {
    let jobs = Arc::new(MemoryJobs::default());
    let outputs = Arc::new(MemoryOutputs {
        jobs: Arc::clone(&jobs),
        images: Mutex::new(Vec::new()),
    });
    let transport: Arc<dyn Transport> = Arc::new(MemoryTransport {
        events,
        eof: Mutex::new(eof),
    });
    let client = novelai_bridge::Client::new(transport, novelai_bridge::ClientConfig::default());
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
    (queue, jobs, outputs)
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
    let (queue, jobs, outputs) = streaming_queue(
        vec![event("intermediate"), event("final")],
        Some(Arc::clone(&eof)),
    );
    let mut feedback = queue.subscribe();
    let job = queue.enqueue(&streamed_submission()).unwrap();
    let worker = tokio::spawn(Arc::clone(&queue).run());
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let mut preview_received = false;
        loop {
            match feedback.recv().await.unwrap() {
                JobFeedback::Preview { image_bytes, .. } => {
                    assert!(image_bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
                    preview_received = true;
                },
                JobFeedback::FinalReceived { .. } => {
                    assert!(preview_received);
                    break;
                },
                JobFeedback::Finished { .. } => panic!("stream ended before its final event"),
                JobFeedback::Started { .. }
                | JobFeedback::Observation { .. }
                | JobFeedback::ResyncRequired => {},
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(jobs.get_job(&job.id).unwrap().status, JobStatus::Running);
    assert!(outputs.images.lock().unwrap().is_empty());
    assert!(jobs.get_job(&job.id).unwrap().observation.is_none());
    eof.notify_one();
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while !matches!(feedback.recv().await.unwrap(), JobFeedback::Finished { .. }) {}
    })
    .await
    .unwrap();
    assert_eq!(terminal(&jobs, &job.id).await, JobStatus::Completed);
    assert_eq!(*outputs.images.lock().unwrap(), [1]);
    assert_eq!(
        jobs.get_job(&job.id).unwrap().observation.unwrap().outcome,
        Some(RequestSettlement::Succeeded { image_count: 1 })
    );
    worker.abort();
    drop(worker.await);
}

#[tokio::test]
async fn incomplete_eof_and_error_after_final_do_not_retain_outputs() {
    for (events, samples) in [
        (vec![event("intermediate")], 1),
        (vec![event("final"), event("error")], 1),
        (vec![event("final")], 2),
    ] {
        let (queue, jobs, outputs) = streaming_queue(events, None);
        let mut frozen = streamed_submission();
        let FrozenSubmission::Generation {
            request, resolved, ..
        } = &mut frozen
        else {
            unreachable!()
        };
        request.core.n_samples = samples;
        resolved.settings.n_samples = samples;
        let job = queue.enqueue(&frozen).unwrap();
        let worker = tokio::spawn(Arc::clone(&queue).run());
        assert_eq!(terminal(&jobs, &job.id).await, JobStatus::Failed);
        assert!(outputs.images.lock().unwrap().is_empty());
        assert!(matches!(
            jobs.get_job(&job.id).unwrap().observation.unwrap().outcome,
            Some(RequestSettlement::Failed { .. })
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
    let (queue, jobs, outputs) = streaming_queue(
        vec![event("intermediate"), event("final")],
        Some(Arc::new(Notify::new())),
    );
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
    let second = queue.enqueue(&streamed_submission()).unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if matches!(feedback.recv().await.unwrap(), JobFeedback::Finished { job_id, .. } if job_id == first.id) {
                break;
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(
        jobs.get_job(&first.id)
            .unwrap()
            .observation
            .unwrap()
            .outcome,
        Some(RequestSettlement::Cancelled)
    );
    assert_eq!(terminal(&jobs, &second.id).await, JobStatus::Completed);
    assert_eq!(*outputs.images.lock().unwrap(), [1]);
    assert_eq!(*jobs.claimed.lock().unwrap(), [first.id.clone(), second.id]);
    assert_eq!(
        jobs.get_job(&first.id).unwrap().status,
        JobStatus::Cancelled
    );
    worker.abort();
    drop(worker.await);
}

#[tokio::test]
async fn unavailable_frozen_input_fails_one_job_and_allows_the_next() {
    let (queue, jobs, outputs) = streaming_queue(vec![event("final")], None);
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
        max_enhance: false,
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

#[tokio::test]
async fn upscale_executes_its_frozen_options_and_retains_returned_images() {
    #[derive(Default)]
    struct UpscaleTransport {
        requests: Mutex<Vec<TransportRequest>>,
    }
    #[async_trait]
    impl Transport for UpscaleTransport {
        async fn execute(
            &self,
            request: TransportRequest,
        ) -> Result<TransportResponse, novelai_bridge::TransportError> {
            self.requests.lock().unwrap().push(request);
            let image = crate::media::AssetReader::image(&ImageAssets, "source").unwrap();
            Ok(TransportResponse::from_bytes(
                200,
                vec![TransportHeader {
                    name: "content-type".to_owned(),
                    value: b"image/png".to_vec(),
                }],
                image.as_bytes().to_vec(),
            ))
        }
    }
    let transport = Arc::new(UpscaleTransport::default());
    let erased: Arc<dyn Transport> = Arc::<UpscaleTransport>::clone(&transport);
    let client = novelai_bridge::Client::new(erased, novelai_bridge::ClientConfig::default());
    let (mut queue, jobs, outputs) = streaming_queue(Vec::new(), None);
    let mutable = Arc::get_mut(&mut queue).unwrap();
    mutable.assets = Arc::new(ImageAssets);
    mutable.clients = Arc::new(MemoryClient(client));
    let mut draft = Draft::default();
    draft.inputs.operation = crate::session::CreationOperation::Upscale {
        asset_id: "source".to_owned(),
        model: novelai_bridge::Model::NaiDiffusion5Curated,
        declared_blur_sigma: novelai_bridge::UpscaleBlurSigma::Sigma035,
    };
    let frozen = queue.freeze(&draft).unwrap();
    let retained = sqlite::decode_submission(&sqlite::encode_submission(&frozen).unwrap()).unwrap();
    let job = queue.enqueue(&retained).unwrap();
    let worker = tokio::spawn(Arc::clone(&queue).run());
    assert_eq!(terminal(&jobs, &job.id).await, JobStatus::Completed);
    assert_eq!(*outputs.images.lock().unwrap(), [1]);
    {
        let requests = transport.requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].endpoint.ends_with("/ai/upscale"));
        let body: serde_json::Value =
            serde_json::from_slice(requests[0].body.as_ref().unwrap()).unwrap();
        assert_eq!(body["model"], "nai-diffusion-5-curated");
        assert_eq!(body["declared_blur_sigma"], 0.35);
        assert!(body.get("parameters").is_none());
    }
    worker.abort();
    drop(worker.await);
}
