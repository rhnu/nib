//! Pure aggregation of durable request states into one notice per submission batch.

use std::collections::{HashMap, HashSet};

use nib_app::jobs::{JobStatus, JobSummary};

#[derive(Default)]
pub(super) struct Batches {
    pending: HashMap<String, HashMap<String, JobStatus>>,
    finished: HashSet<String>,
}

pub(super) struct BatchNotice {
    completed: usize,
    failed: usize,
    cancelled: usize,
}

impl Batches {
    pub(super) fn observe(&mut self, job: &JobSummary) -> Option<BatchNotice> {
        self.observe_status(&job.batch_id, &job.id, job.request_count, job.status)
    }

    fn observe_status(
        &mut self,
        batch: &str,
        id: &str,
        count: u32,
        status: JobStatus,
    ) -> Option<BatchNotice> {
        if self.finished.contains(batch) {
            return None;
        }
        let jobs = self.pending.entry(batch.to_owned()).or_default();
        jobs.insert(id.to_owned(), status);
        if jobs.len() != count as usize
            || jobs
                .values()
                .any(|status| matches!(status, JobStatus::Queued | JobStatus::Running))
        {
            return None;
        }
        let notice = BatchNotice {
            completed: jobs
                .values()
                .filter(|&&status| status == JobStatus::Completed)
                .count(),
            failed: jobs
                .values()
                .filter(|&&status| matches!(status, JobStatus::Failed | JobStatus::Interrupted))
                .count(),
            cancelled: jobs
                .values()
                .filter(|&&status| status == JobStatus::Cancelled)
                .count(),
        };
        self.pending.remove(batch);
        self.finished.insert(batch.to_owned());
        (notice.completed + notice.failed > 0).then_some(notice)
    }
}

impl BatchNotice {
    pub(super) fn message(&self, chinese: bool) -> (&'static str, String) {
        let failed = self.failed > 0;
        if chinese {
            (
                if failed {
                    "nib · 批次包含失败任务"
                } else {
                    "nib · 批次已完成"
                },
                format!(
                    "{} 项完成，{} 项失败，{} 项取消。",
                    self.completed, self.failed, self.cancelled
                ),
            )
        } else {
            (
                if failed {
                    "nib · Batch finished with errors"
                } else {
                    "nib · Batch completed"
                },
                format!(
                    "{} completed, {} failed, {} cancelled.",
                    self.completed, self.failed, self.cancelled
                ),
            )
        }
    }
}

#[cfg(test)]
mod tests;
