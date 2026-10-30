use std::{error::Error as _, io};

use super::LexiconError;

#[test]
fn backend_failures_preserve_the_original_cause() {
    let error = LexiconError::Failure(Box::new(io::Error::new(
        io::ErrorKind::PermissionDenied,
        "blocked",
    )));
    assert!(matches!(error, LexiconError::Failure(_)));
    assert_eq!(
        error
            .source()
            .unwrap()
            .downcast_ref::<io::Error>()
            .unwrap()
            .kind(),
        io::ErrorKind::PermissionDenied
    );
}
