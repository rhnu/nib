use std::pin::pin;

use futures_util::poll;

use super::DataAccess;
use crate::{api::UserMessage, persistence::PersistenceError};

#[tokio::test]
async fn initial_state_admits_data_and_credential_writes() {
    let access = DataAccess::default();
    assert!(access.is_writable());
    drop(access.write().await.unwrap());
    drop(access.exclusive_write().await.unwrap());
}

#[tokio::test]
async fn relocation_rejects_duplicate_start_and_new_writes() {
    let access = DataAccess::default();
    access.begin_relocation().unwrap();
    assert!(!access.is_writable());
    assert!(matches!(
        access.begin_relocation(),
        Err(PersistenceError::InvalidData {
            message: UserMessage::MigrationInProgress,
        })
    ));
    assert!(matches!(
        access.write().await,
        Err(PersistenceError::InvalidData {
            message: UserMessage::MigrationInProgress,
        })
    ));
    assert!(matches!(
        access.exclusive_write().await,
        Err(PersistenceError::InvalidData {
            message: UserMessage::MigrationInProgress,
        })
    ));
}

#[tokio::test]
async fn finishing_without_restart_restores_writes_and_allows_another_relocation() {
    let access = DataAccess::default();
    access.begin_relocation().unwrap();
    // Failure and a completed no-op both finish without requiring a restart.
    access.finish_relocation(false);
    assert!(access.is_writable());
    drop(access.write().await.unwrap());
    drop(access.exclusive_write().await.unwrap());
    access.begin_relocation().unwrap();
    access.finish_relocation(false);
    drop(access.write().await.unwrap());
}

#[tokio::test]
async fn restart_requirement_rejects_writes_and_relocation_but_keeps_reads_available() {
    let access = DataAccess::default();
    access.begin_relocation().unwrap();
    access.finish_relocation(true);
    assert!(!access.is_writable());
    assert!(matches!(
        access.write().await,
        Err(PersistenceError::InvalidData {
            message: UserMessage::RestartRequired,
        })
    ));
    assert!(matches!(
        access.exclusive_write().await,
        Err(PersistenceError::InvalidData {
            message: UserMessage::RestartRequired,
        })
    ));
    assert!(matches!(
        access.begin_relocation(),
        Err(PersistenceError::InvalidData {
            message: UserMessage::RestartRequired,
        })
    ));
    let mut read = pin!(access.read());
    assert!(poll!(read.as_mut()).is_ready());
}

#[tokio::test]
async fn relocation_exclusive_access_waits_for_an_existing_writer() {
    let access = DataAccess::default();
    let writer = access.write().await.unwrap();
    access.begin_relocation().unwrap();
    let mut exclusive = pin!(access.exclusive());
    assert!(poll!(exclusive.as_mut()).is_pending());
    drop(writer);
    assert!(poll!(exclusive.as_mut()).is_ready());
}
