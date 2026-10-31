//! Host-owned batch notifications, observed independently from window feedback subscriptions.

mod batches;

use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};

use batches::{BatchNotice, Batches};
use nib_app::{
    jobs::{JobError, JobQuery, JobQueue, JobSummary},
    persistence::PersistenceError,
    settings::Language,
    state::AppState,
};
use tauri::Manager as _;
use tauri_plugin_notification::NotificationExt as _;

/// One observer per desktop process; creating it does not initialize generation.
pub(crate) struct Notifications {
    handle: tauri::AppHandle,
    app: AppState,
    worker: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

impl Notifications {
    pub(crate) fn new(handle: tauri::AppHandle, app: AppState) -> Self {
        Self {
            handle,
            app,
            worker: Mutex::new(None),
        }
    }

    /// Establishes the history baseline synchronously before the first queue command runs.
    pub(crate) fn start(&self, queue: Arc<JobQueue>) -> Result<(), JobError> {
        let mut worker = self
            .worker
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        if worker.is_some() {
            return Ok(());
        }
        let mut changes = queue.subscribe_status();
        let baseline = queue.list(&JobQuery {
            limit: 1,
            before: None,
        })?;
        let mut cursor = Cursor {
            newest: baseline.items.first().map(|job| job.id.clone()),
            active: baseline.active.iter().map(|job| job.id.clone()).collect(),
        };
        let mut batches = Batches::default();
        for job in baseline.active {
            batches.observe(&job);
        }
        let handle = self.handle.clone();
        let app = self.app.clone();
        *worker = Some(tauri::async_runtime::spawn(async move {
            while changes.changed().await.is_ok() {
                let queue = Arc::clone(&queue);
                let previous = cursor.clone();
                let app = app.clone();
                let access = app.read_access().await;
                let snapshot = tauri::async_runtime::spawn_blocking(move || {
                    let _access = access;
                    let (jobs, cursor) = previous.read(&queue)?;
                    let language = app.settings().preferences()?.language;
                    Ok::<_, JobError>((jobs, cursor, language))
                })
                .await;
                match snapshot {
                    Ok(Ok((jobs, next, language))) => {
                        cursor = next;
                        for job in jobs {
                            if let Some(notice) = batches.observe(&job) {
                                show(&handle, language, &notice);
                            }
                        }
                    },
                    Ok(Err(error)) => tracing::warn!(
                        detail = %nib_app::api::error_detail(&error),
                        "cannot refresh durable task notification state"
                    ),
                    Err(error) => tracing::error!(
                        error = %error,
                        "task notification observer read was interrupted"
                    ),
                }
            }
        }));
        Ok(())
    }
}

/// Terminal history is ordered by submission, so older active jobs need explicit rereads.
#[derive(Clone)]
struct Cursor {
    newest: Option<String>,
    active: HashSet<String>,
}

impl Cursor {
    fn read(&self, queue: &JobQueue) -> Result<(Vec<JobSummary>, Self), JobError> {
        let mut page = queue.list(&JobQuery {
            limit: 100,
            before: None,
        })?;
        let newest = page.items.first().map(|job| job.id.clone());
        let active = page.active.iter().map(|job| job.id.clone()).collect();
        let mut jobs = page.active;
        loop {
            let mut reached_previous = false;
            for job in page.items {
                if self.newest.as_deref() == Some(job.id.as_str()) {
                    reached_previous = true;
                    break;
                }
                jobs.push(job);
            }
            if reached_previous || page.next_cursor.is_none() {
                break;
            }
            page = queue.list(&JobQuery {
                limit: 100,
                before: page.next_cursor,
            })?;
        }
        let seen: HashSet<_> = jobs.iter().map(|job| job.id.as_str()).collect();
        let missing: Vec<_> = self
            .active
            .iter()
            .filter(|id| !seen.contains(id.as_str()))
            .collect();
        for id in missing {
            jobs.push(JobSummary::from(&queue.get(id)?));
        }
        Ok((jobs, Self { newest, active }))
    }
}

fn show(handle: &tauri::AppHandle, language: Language, notice: &BatchNotice) {
    let Some(window) = handle.get_webview_window("main") else {
        return;
    };
    match window.is_focused() {
        Ok(true) => return,
        Ok(false) => {},
        Err(error) => {
            tracing::warn!(error = %error, "cannot determine task notification window focus");
            return;
        },
    }
    let chinese = match language {
        Language::ZhCn => true,
        Language::En => false,
        Language::System => sys_locale::get_locales()
            .find_map(|locale| supported_locale(&locale))
            .unwrap_or(false),
    };
    let (title, body) = notice.message(chinese);
    if let Err(error) = handle
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show()
    {
        tracing::warn!(error = %error, "cannot send native task notification");
    }
}

/// Match the frontend's supported system language selection, including script and region.
fn supported_locale(locale: &str) -> Option<bool> {
    let mut parts = locale.split(['-', '_']);
    let language = parts.next()?;
    if language.eq_ignore_ascii_case("en") {
        return Some(false);
    }
    if !language.eq_ignore_ascii_case("zh") {
        return None;
    }
    let mut script = None;
    let mut region = None;
    for part in parts {
        if part.len() == 4 {
            script = Some(part);
        } else if part.len() == 2
            || (part.len() == 3 && part.bytes().all(|byte| byte.is_ascii_digit()))
        {
            region = Some(part);
        }
    }
    if script.is_some_and(|script| script.eq_ignore_ascii_case("hant")) {
        return None;
    }
    if script.is_some_and(|script| script.eq_ignore_ascii_case("hans"))
        || region.is_none_or(|region| {
            region.eq_ignore_ascii_case("cn") || region.eq_ignore_ascii_case("sg")
        })
    {
        Some(true)
    } else {
        None
    }
}

#[cfg(test)]
mod tests;
