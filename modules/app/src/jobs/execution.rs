//! SDK execution preserves request settlement and commits streamed finals only after clean EOF.
use std::{
    collections::BTreeMap,
    sync::Arc,
    time::{Duration, Instant},
};

use futures_util::StreamExt;
use novelai_bridge::{
    EncodeVibeRequest, GenerateImageResult, ImageStreamEvent, RunDirectorToolRequest,
    UpscaleImageRequest,
};
use tokio::sync::Notify;

use super::{
    ActiveJob, FrozenSubmission, JobError, JobFeedback, JobQueue, JobRecord, public_failure,
    report_failure,
};
use crate::{media::JobOutput, persistence::PersistenceError};

impl JobQueue {
    pub(super) async fn run_inner(self: &Arc<Self>) -> Result<(), JobError> {
        loop {
            let store = Arc::clone(&self.store);
            let Some(next) = tokio::task::spawn_blocking(move || store.claim_job()).await?? else {
                self.wake.notified().await;
                continue;
            };
            let id = next.id.clone();
            drop(
                self.feedback
                    .send(JobFeedback::Started { job_id: id.clone() }),
            );
            let cancel = Arc::new(Notify::new());
            *self
                .active
                .lock()
                .map_err(|_poisoned| PersistenceError::Locked)? = Some(ActiveJob {
                id: id.clone(),
                cancel: Arc::clone(&cancel),
            });
            let queue = Arc::clone(self);
            // An explicit cancel does not abort this future. Streaming cancel must finish
            // SDK observation; ordinary requests settle before the next queue item starts.
            let mut task = tokio::task::JoinSet::new();
            task.spawn(async move { queue.execute(&next, cancel).await });
            let outcome = task.join_next().await;
            let failure = match outcome {
                Some(Ok(Ok(()))) => None,
                Some(Ok(Err(error))) => {
                    if matches!(error, JobError::Persistence(_)) {
                        return Err(error);
                    }
                    report_failure(&id, &error);
                    Some(public_failure(&error))
                },
                Some(Err(error)) => {
                    report_failure(&id, &JobError::Worker(error));
                    Some("生成执行过程已中断。".to_owned())
                },
                None => Some("生成执行过程已中断。".to_owned()),
            };
            if let Some(message) = failure {
                let store = Arc::clone(&self.store);
                let failed_id = id.clone();
                tokio::task::spawn_blocking(move || store.fail_job(&failed_id, &message)).await??;
            }
            *self
                .active
                .lock()
                .map_err(|_poisoned| PersistenceError::Locked)? = None;
            let store = Arc::clone(&self.store);
            let finished = tokio::task::spawn_blocking(move || store.get_job(&id)).await??;
            drop(self.feedback.send(JobFeedback::Finished {
                job_id: finished.id,
                status: finished.status,
                error: finished.error,
                observation: finished.observation,
            }));
        }
    }

    async fn execute(
        self: &Arc<Self>,
        record: &JobRecord,
        cancel: Arc<Notify>,
    ) -> Result<(), JobError> {
        let queue = Arc::clone(self);
        let id = record.id.clone();
        let execution = record.execution;
        let client = tokio::task::spawn_blocking(move || {
            if !queue.store.job_running(&id)? {
                return Ok(None);
            }
            queue.clients.client_for(execution).map(Some)
        })
        .await??;
        let Some(client) = client else {
            return Ok(());
        };
        let account = client.last_subscription().as_ref().map(|info| {
            let mut summary = crate::settings::AccountSummary::from(info);
            summary.sampled_at = *self
                .account_sampled_at
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            summary
        });
        let observer =
            super::observation::JobObserver::new(record.id.clone(), account, self.feedback.clone());
        let client =
            client.with_credit_observer(Arc::<super::observation::JobObserver>::clone(&observer));
        let outcome = self.execute_operation(record, cancel, client).await;
        if let Some(observation) = observer.snapshot() {
            let store = Arc::clone(&self.store);
            let id = record.id.clone();
            tokio::task::spawn_blocking(move || store.observe_job(&id, &observation)).await??;
        }
        outcome
    }

    async fn execute_operation(
        self: &Arc<Self>,
        record: &JobRecord,
        cancel: Arc<Notify>,
        client: super::SdkClient,
    ) -> Result<(), JobError> {
        let queue = Arc::clone(self);
        let submission = record.submission.clone();
        let prepared = tokio::task::spawn_blocking(move || {
            prepare_operation(submission, queue.assets.as_ref())
        })
        .await??;
        // Cancellation may race local image preparation or client construction.
        let store = Arc::clone(&self.store);
        let id = record.id.clone();
        if !tokio::task::spawn_blocking(move || store.job_running(&id)).await?? {
            return Ok(());
        }
        let output = match prepared {
            PreparedOperation::Generation { prepared, stream } => {
                if let Some(mode) = stream {
                    let mut stream = client.generate_stream_prepared(*prepared, mode).await?;
                    let seed = stream.resolved_seed;
                    let mut finals = BTreeMap::new();
                    let mut previews = PreviewBudget::default();
                    loop {
                        tokio::select! {
                            biased;
                            ()=cancel.notified()=>{stream.cancel().await;return Ok(());},
                            chunk=stream.next()=>{
                                let Some(chunk)=chunk else {break;};
                                match chunk?.event {
                                    ImageStreamEvent::Intermediate {samp_ix,step_ix,image,..} => {
                                        if previews.accept(samp_ix, image.len(), Instant::now()) {
                                            drop(self.feedback.send(JobFeedback::Preview {
                                                job_id:record.id.clone(),sample_index:samp_ix,step_index:step_ix,
                                                mime_type: preview_mime(&image).map(str::to_owned), image_bytes:image,
                                            }));
                                        }
                                    },
                                    ImageStreamEvent::Final {samp_ix,image,..} => {finals.insert(samp_ix,image);drop(self.feedback.send(JobFeedback::FinalReceived {job_id:record.id.clone(),sample_index:samp_ix}));},
                                    ImageStreamEvent::Error {..}|ImageStreamEvent::Unknown {..}=>{},
                                }
                            },
                        }
                    }
                    // SDK EOF validation rejects missing/duplicate finals and settles observation.
                    // A final event alone is deliberately insufficient for durable completion.
                    JobOutput::Generation(GenerateImageResult {
                        resolved_seed: seed,
                        images: finals.into_values().collect(),
                    })
                } else {
                    JobOutput::Generation(client.generate_prepared(*prepared).await?)
                }
            },
            PreparedOperation::Director(prepared) => {
                JobOutput::Director(client.run_director_tool_prepared(prepared).await?)
            },
            PreparedOperation::Vibe(prepared) => {
                JobOutput::Vibe(client.encode_vibe_prepared(prepared).await?)
            },
            PreparedOperation::Upscale(prepared) => {
                JobOutput::Upscale(client.upscale_prepared(prepared).await?)
            },
        };
        let media = Arc::clone(&self.media);
        let record = record.clone();
        tokio::task::spawn_blocking(move || media.retain(&record, output)).await??;
        Ok(())
    }
}

/// The SDK bounds protocol payloads; this smaller display budget also bounds the IPC ring.
#[derive(Default)]
struct PreviewBudget(BTreeMap<u32, Instant>);

impl PreviewBudget {
    fn accept(&mut self, sample: u32, bytes: usize, now: Instant) -> bool {
        if bytes > 4 * 1024 * 1024
            || bytes == 0
            || self
                .0
                .get(&sample)
                .is_some_and(|last| now.duration_since(*last) < Duration::from_millis(100))
        {
            return false;
        }
        self.0.insert(sample, now);
        true
    }
}

fn preview_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else {
        None
    }
}

#[cfg(test)]
mod tests;

enum PreparedOperation {
    Generation {
        prepared: Box<novelai_bridge::PreparedGeneration>,
        stream: Option<novelai_bridge::StreamMode>,
    },
    Director(novelai_bridge::PreparedDirector),
    Vibe(novelai_bridge::PreparedVibe),
    Upscale(novelai_bridge::PreparedUpscale),
}

fn prepare_operation(
    submission: FrozenSubmission,
    assets: &dyn crate::media::AssetReader,
) -> Result<PreparedOperation, JobError> {
    match submission {
        FrozenSubmission::Generation {
            request, resolved, ..
        } => Ok(PreparedOperation::Generation {
            prepared: Box::new(
                super::operations::hydrate(*request, &resolved.inputs, assets)?
                    .normalize()?
                    .prepare()?,
            ),
            stream: resolved.inputs.stream,
        }),
        FrozenSubmission::Director {
            asset_id,
            command,
            policy,
            ..
        } => Ok(PreparedOperation::Director(
            RunDirectorToolRequest {
                image: super::operations::image(assets, &asset_id)?,
                command,
                policy,
            }
            .prepare()?,
        )),
        FrozenSubmission::EncodeVibe {
            asset_id,
            model,
            information_extracted,
            mask_asset_id,
            crop_to_mask,
            focus_seed,
            info_extract_seed,
            policy,
            ..
        } => Ok(PreparedOperation::Vibe(
            EncodeVibeRequest {
                image: super::operations::image(assets, &asset_id)?,
                model,
                information_extracted,
                mask: mask_asset_id
                    .as_ref()
                    .map(|id| super::operations::image(assets, id))
                    .transpose()?,
                crop_to_mask,
                focus_seed,
                info_extract_seed,
                policy,
            }
            .prepare()?,
        )),
        FrozenSubmission::Upscale {
            asset_id,
            model,
            declared_blur_sigma,
            ..
        } => Ok(PreparedOperation::Upscale(
            UpscaleImageRequest {
                image: super::operations::image(assets, &asset_id)?,
                model,
                declared_blur_sigma,
            }
            .prepare()?,
        )),
    }
}
