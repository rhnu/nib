use nib_app::{api::ErrorCode, persistence::PersistenceError};
use novelai_bridge::{EncodedImage, PngTextEntry};

use super::png_text_error;

#[test]
fn png_text_validation_exposes_sdk_duplicate_and_keyword_causes() {
    let image = EncodedImage::from_base64("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAC0lEQVR4nGNgQAcAABIAAXfx+gAAAAAASUVORK5CYII=").unwrap();
    for (entries, expected_cause) in [
        (
            vec![
                PngTextEntry::new("Comment", "first"),
                PngTextEntry::new("comment", "second"),
            ],
            "duplicate replacement keyword",
        ),
        (vec![PngTextEntry::new("", "value")], "keyword"),
    ] {
        let sdk_error =
            novelai_bridge::write_png_text_chunks(image.as_bytes(), &entries).unwrap_err();
        let error = png_text_error(PersistenceError::failure(
            "write retained PNG text",
            sdk_error,
        ));
        assert!(matches!(error.code, ErrorCode::Invalid));
        assert!(error.message.contains(expected_cause), "{}", error.message);
    }
}

#[test]
fn png_text_storage_failure_keeps_unavailable_classification() {
    let error = png_text_error(PersistenceError::failure(
        "write retained image",
        std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied"),
    ));
    assert!(matches!(error.code, ErrorCode::Unavailable));
}
