//! Window-scoped frontend subscriptions around shared application state.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use nib_app::{persistence::PersistenceError, state::AppState};

struct FeedbackSubscription {
    id: String,
    worker: Option<tauri::async_runtime::JoinHandle<()>>,
}

#[derive(Clone)]
pub(crate) struct DesktopState {
    pub(crate) app: AppState,
    feedback: Arc<Mutex<HashMap<String, FeedbackSubscription>>>,
}

impl DesktopState {
    pub(crate) fn new(app: AppState) -> Self {
        Self {
            app,
            feedback: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub(crate) fn begin_feedback(&self, label: String, id: String) -> Result<(), PersistenceError> {
        let mut feedback = self
            .feedback
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        if let Some(FeedbackSubscription {
            worker: Some(previous),
            ..
        }) = feedback.insert(label, FeedbackSubscription { id, worker: None })
        {
            previous.abort();
        }
        Ok(())
    }

    pub(crate) fn attach_feedback(
        &self,
        label: &str,
        id: &str,
        worker: tauri::async_runtime::JoinHandle<()>,
    ) -> Result<(), PersistenceError> {
        let Ok(mut feedback) = self.feedback.lock() else {
            worker.abort();
            return Err(PersistenceError::Locked);
        };
        if let Some(subscription) = feedback.get_mut(label)
            && subscription.id == id
        {
            if let Some(previous) = subscription.worker.replace(worker) {
                previous.abort();
            }
        } else {
            worker.abort();
        }
        Ok(())
    }

    pub(crate) fn stop_feedback(
        &self,
        label: &str,
        id: Option<&str>,
    ) -> Result<(), PersistenceError> {
        let mut feedback = self
            .feedback
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        if feedback
            .get(label)
            .is_some_and(|subscription| id.is_none_or(|id| subscription.id == id))
            && let Some(FeedbackSubscription {
                worker: Some(worker),
                ..
            }) = feedback.remove(label)
        {
            worker.abort();
        }
        Ok(())
    }
}
