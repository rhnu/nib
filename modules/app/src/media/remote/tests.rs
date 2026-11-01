use std::io::Cursor;

use super::{RemoteImageError, allowed_url, validate_image};

#[test]
fn accepts_only_http_image_addresses_without_credentials() {
    for value in [
        "https://example.com/image.png?q=1",
        "http://example.com/image",
    ] {
        assert!(allowed_url(&reqwest::Url::parse(value).unwrap()));
    }
    for value in [
        "file:///C:/image.png",
        "https://user:password@example.com/image.png",
        "ftp://example.com/image.png",
    ] {
        assert!(!allowed_url(&reqwest::Url::parse(value).unwrap()));
    }
}

#[test]
fn validates_pixels_and_rejects_mislabelled_or_truncated_images() {
    let mut bytes = Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(2, 3)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    assert!(validate_image(bytes.get_ref(), "image/png").is_ok());
    assert!(matches!(
        validate_image(bytes.get_ref(), "image/jpeg"),
        Err(RemoteImageError::Rejected)
    ));
    assert!(validate_image(&bytes.get_ref()[..24], "image/png").is_err());
}
