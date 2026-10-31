use super::*;

#[test]
fn thumbnails_preserve_aspect_ratio_and_remain_independent_png_content() {
    let image =
        EncodedImage::from_bytes(include_bytes!("../../jobs/tests/large-source.png").to_vec())
            .unwrap();
    let thumbnail = prepare_thumbnail(&image).unwrap();
    let decoded = EncodedImage::from_bytes(thumbnail.as_bytes().to_vec()).unwrap();
    assert_eq!(decoded.size().width.max(decoded.size().height), 256);
    let source_ratio = f64::from(image.size().width) / f64::from(image.size().height);
    let output_ratio = f64::from(decoded.size().width) / f64::from(decoded.size().height);
    assert!((source_ratio - output_ratio).abs() < 0.01);
    assert!(thumbnail.as_bytes().starts_with(b"\x89PNG\r\n\x1a\n"));
    assert!(thumbnail.as_bytes().len() < image.as_bytes().len());
}

#[test]
fn blob_identity_uses_exact_bytes_and_rejects_noncanonical_text() {
    let empty = BlobId::for_bytes(b"");
    assert_eq!(
        empty.as_str(),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    assert_ne!(BlobId::for_bytes(b"a"), BlobId::for_bytes(b"a\n"));
    assert_eq!(empty.as_str().parse::<BlobId>().unwrap(), empty);
    assert!(empty.as_str().to_uppercase().parse::<BlobId>().is_err());
    assert!("../outside".parse::<BlobId>().is_err());
}

#[test]
fn asset_id_generation_and_validation_use_canonical_uuids() {
    let id = AssetId::new().to_string();
    assert_eq!(uuid::Uuid::parse_str(&id).unwrap().get_version_num(), 4);
    assert_eq!(AssetId::parse(&id).unwrap().to_string(), id);
    assert!(AssetId::parse("A86D53EC-9530-42BC-8335-D25E8C8ED40F").is_err());
    assert!(AssetId::parse("invalid").is_err());
    assert!(AssetId::parse("00000000-0000-0000-0000-000000000000").is_err());
    assert!(AssetId::parse("../outside").is_err());
}

#[test]
fn thumbnails_reject_modified_content_and_invalid_checksums() {
    let image =
        EncodedImage::from_bytes(include_bytes!("../../jobs/tests/large-source.png").to_vec())
            .unwrap();
    let thumbnail = prepare_thumbnail(&image).unwrap();
    let checksum = BlobId::for_bytes(thumbnail.as_bytes());
    assert!(
        validated_thumbnail(thumbnail.as_bytes().to_vec(), checksum.as_str().as_bytes()).is_some()
    );
    let mut damaged = thumbnail.as_bytes().to_vec();
    damaged[20] ^= 1;
    assert!(validated_thumbnail(damaged, checksum.as_str().as_bytes()).is_none());
    assert!(validated_thumbnail(thumbnail.as_bytes().to_vec(), &[255]).is_none());
}
