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
