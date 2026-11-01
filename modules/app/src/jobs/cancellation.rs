//! Queued-only cancellation preserves already claimed requests and their previews.

use super::{JobError, JobFeedback, JobQueue, JobRecord, JobStatus, JobSummary};

impl JobQueue {
    /// Cancels queued work; a request that has already started continues normally.
    /// # Errors
    /// Returns missing task or storage failures.
    pub fn cancel(&self, id: &str) -> Result<JobRecord, JobError> {
        let record = self.store.cancel_job(id)?;
        self.publish_cancellations(std::iter::once(JobSummary::from(&record)));
        Ok(record)
    }

    /// Stops the remaining queued requests in a batch without interrupting its active request.
    /// # Errors
    /// Returns missing batch or storage failures.
    pub fn cancel_batch(&self, batch_id: &str) -> Result<Vec<JobSummary>, JobError> {
        let jobs = self.store.cancel_batch(batch_id)?;
        tracing::info!(
            batch_id,
            cancelled = jobs
                .iter()
                .filter(|job| job.status == JobStatus::Cancelled)
                .count(),
            "stopped queued batch requests"
        );
        self.publish_cancellations(jobs.iter().cloned());
        Ok(jobs)
    }

    fn publish_cancellations(&self, jobs: impl IntoIterator<Item = JobSummary>) {
        self.status_changed.send_replace(());
        for job in jobs {
            if job.status == JobStatus::Cancelled {
                drop(self.feedback.send(JobFeedback::Finished {
                    job_id: job.id,
                    status: job.status,
                    error: job.error,
                    observation: job.observation,
                }));
            }
        }
    }
}
