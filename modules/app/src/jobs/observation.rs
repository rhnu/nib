//! Small, payload-free projections of the SDK's inline credit observations.

use std::sync::{Arc, Mutex};

use novelai_bridge::{CreditEvent, CreditObserver, RequestFailure, RequestOutcome};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

use super::JobFeedback;
use crate::settings::AccountSummary;

/// An estimate and SDK settlement are evidence of execution, never proof of an actual charge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct JobObservation {
    #[cfg_attr(feature = "typegen", ts(type = "number"))]
    pub request_id: u64,
    pub estimated_anlas: Option<u32>,
    pub outcome: Option<RequestSettlement>,
    pub account: Option<AccountSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum RequestSettlement {
    Succeeded {
        image_count: u32,
    },
    Failed {
        failure: String,
        http_status: Option<u16>,
    },
    Cancelled,
}

impl From<RequestOutcome> for RequestSettlement {
    fn from(outcome: RequestOutcome) -> Self {
        match outcome {
            RequestOutcome::Succeeded { image_count } => Self::Succeeded { image_count },
            RequestOutcome::Cancelled => Self::Cancelled,
            RequestOutcome::Failed { failure } => {
                let (category, http_status) = match failure {
                    RequestFailure::Stream => ("stream", None),
                    RequestFailure::InvalidRequest => ("invalidRequest", None),
                    RequestFailure::Preparation => ("preparation", None),
                    RequestFailure::Api { status } => ("api", Some(status)),
                    RequestFailure::Transport => ("transport", None),
                    RequestFailure::Encode => ("encode", None),
                    RequestFailure::Decode => ("decode", None),
                    RequestFailure::Metadata => ("metadata", None),
                };
                Self::Failed {
                    failure: category.to_owned(),
                    http_status,
                }
            },
        }
    }
}

pub(super) struct JobObserver {
    job_id: String,
    account: Option<AccountSummary>,
    value: Mutex<Option<JobObservation>>,
    feedback: broadcast::Sender<JobFeedback>,
}

impl JobObserver {
    pub(super) fn new(
        job_id: String,
        account: Option<AccountSummary>,
        feedback: broadcast::Sender<JobFeedback>,
    ) -> Arc<Self> {
        Arc::new(Self {
            job_id,
            account,
            value: Mutex::new(None),
            feedback,
        })
    }

    pub(super) fn snapshot(&self) -> Option<JobObservation> {
        self.value
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }
}

#[async_trait::async_trait]
impl CreditObserver for JobObserver {
    async fn observe(&self, event: CreditEvent) {
        let mut value = self
            .value
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        match event {
            CreditEvent::RequestPlanned {
                fingerprint,
                estimate,
            } => {
                *value = Some(JobObservation {
                    request_id: fingerprint.request_id,
                    estimated_anlas: estimate.total(),
                    outcome: None,
                    account: self.account.clone(),
                });
            },
            CreditEvent::RequestSettled {
                fingerprint,
                outcome,
            } => {
                if let Some(value) = value.as_mut()
                    && value.request_id == fingerprint.request_id
                {
                    value.outcome = Some(outcome.into());
                }
            },
            CreditEvent::BalanceSampled { .. } => return,
        }
        if let Some(observation) = value.clone() {
            drop(self.feedback.send(JobFeedback::Observation {
                job_id: self.job_id.clone(),
                observation,
            }));
        }
    }
}

#[cfg(test)]
mod tests;
