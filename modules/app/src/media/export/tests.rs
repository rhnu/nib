use std::io::Cursor;

use image::{ImageEncoder as _, ImageReader, Rgba, RgbaImage};

use super::*;

fn encode(pixels: &DynamicImage, format: ImageFormat) -> Vec<u8> {
    let mut bytes = Cursor::new(Vec::new());
    pixels.write_to(&mut bytes, format).unwrap();
    bytes.into_inner()
}

fn stealth_image() -> (RgbaImage, RgbaImage) {
    let mut expected = RgbaImage::from_pixel(40, 30, Rgba([37, 61, 83, 255]));
    expected.put_pixel(39, 29, Rgba([9, 6, 3, 128]));
    let mut hidden = expected.clone();
    let private = br#"{"Description":"private prompt"}"#;
    // A single raw DEFLATE stored block supplies valid compressed metadata without an
    // additional test dependency. Its contents are independent of the erasure implementation.
    let length = u16::try_from(private.len()).unwrap();
    let mut compressed = vec![1];
    compressed.extend_from_slice(&length.to_le_bytes());
    compressed.extend_from_slice(&(!length).to_le_bytes());
    compressed.extend_from_slice(private);
    let mut carrier = b"stealth_pngcomp".to_vec();
    carrier.extend_from_slice(&u32::try_from(compressed.len() * 8).unwrap().to_be_bytes());
    carrier.extend_from_slice(&compressed);
    for (byte_index, byte) in carrier.iter().enumerate() {
        for shift in 0..8 {
            let position = u32::try_from(byte_index * 8 + shift).unwrap();
            let pixel = hidden.get_pixel_mut(position / 30, position % 30);
            pixel[3] = 0xFE | ((byte >> (7 - shift)) & 1);
        }
    }
    (hidden, expected)
}

fn private_png() -> (Vec<u8>, RgbaImage) {
    let (hidden, expected) = stealth_image();
    let mut bytes = Vec::new();
    let mut encoder = image::codecs::png::PngEncoder::new(&mut bytes);
    encoder
        .set_exif_metadata(b"II\x2a\0\x08\0\0\0\0\0\0\0\0\0".to_vec())
        .unwrap();
    encoder
        .write_image(hidden.as_raw(), 40, 30, image::ExtendedColorType::Rgba8)
        .unwrap();
    let bytes = novelai_bridge::write_png_text_chunks(
        &bytes,
        &[
            novelai_bridge::PngTextEntry::new("Description", "ordinary private prompt"),
            novelai_bridge::PngTextEntry::new("naidata", "embedded private document"),
        ],
    )
    .unwrap();
    (bytes, expected)
}

#[test]
fn original_preserves_exact_bytes_and_identifies_all_supported_formats() {
    let pixels = DynamicImage::new_rgb8(3, 2);
    for (format, mime) in [
        (ImageFormat::Png, "image/png"),
        (ImageFormat::Jpeg, "image/jpeg"),
        (ImageFormat::WebP, "image/webp"),
    ] {
        let bytes = encode(&pixels, format);
        let exported = export_image(bytes.clone(), ImageExportFormat::Original).unwrap();
        assert_eq!(exported.mime_type, mime);
        assert_eq!(exported.bytes, bytes);
    }
    let (bytes, _) = private_png();
    let exported = export_image(bytes.clone(), ImageExportFormat::Original).unwrap();
    assert_eq!(exported.bytes, bytes);
}

#[test]
fn clean_png_erases_all_stealth_bytes_even_when_text_takes_metadata_precedence() {
    let (hidden, _) = stealth_image();
    let stealth = encode(&DynamicImage::ImageRgba8(hidden), ImageFormat::Png);
    let metadata = novelai_bridge::parse_png_metadata_from_bytes(&stealth).unwrap();
    assert_eq!(metadata.prompt.as_deref(), Some("private prompt"));
    assert_eq!(
        metadata.origin,
        Some(novelai_bridge::MetadataOrigin::StealthPngComp)
    );

    let (bytes, expected) = private_png();
    let metadata = novelai_bridge::parse_png_metadata_from_bytes(&bytes).unwrap();
    assert_eq!(
        metadata.origin,
        Some(novelai_bridge::MetadataOrigin::PngText)
    );
    let mut source_decoder = ImageReader::new(Cursor::new(&bytes))
        .with_guessed_format()
        .unwrap()
        .into_decoder()
        .unwrap();
    assert!(source_decoder.exif_metadata().unwrap().is_some());
    drop(source_decoder);

    let exported = export_image(bytes, ImageExportFormat::CleanPng).unwrap();
    assert_eq!(exported.mime_type, "image/png");
    // Comparing every alpha sample catches erasure of only the discoverable signature.
    assert_eq!(
        image::load_from_memory(&exported.bytes).unwrap().to_rgba8(),
        expected
    );
    assert!(
        novelai_bridge::parse_png_metadata_from_bytes(&exported.bytes)
            .unwrap()
            .is_empty()
    );
    let mut decoder = ImageReader::new(Cursor::new(exported.bytes))
        .with_guessed_format()
        .unwrap()
        .into_decoder()
        .unwrap();
    assert!(decoder.exif_metadata().unwrap().is_none());
}

#[test]
fn clean_png_preserves_unmarked_transparency_and_sixteen_bit_samples() {
    let eight = RgbaImage::from_fn(32, 16, |x, y| {
        Rgba([11, 33, 55, u8::try_from(x + y * 13).unwrap()])
    });
    let sixteen = image::ImageBuffer::from_fn(32, 16, |x, y| {
        image::Rgba([
            1234_u16,
            2345,
            3456,
            u16::try_from(x * 128 + y * 2048).unwrap(),
        ])
    });
    for pixels in [
        DynamicImage::ImageRgba8(eight),
        DynamicImage::ImageRgba16(sixteen),
    ] {
        let bytes = encode(&pixels, ImageFormat::Png);
        let exported = export_image(bytes, ImageExportFormat::CleanPng).unwrap();
        assert_eq!(image::load_from_memory(&exported.bytes).unwrap(), pixels);
    }
}

#[test]
fn clean_png_erases_grayscale_alpha_carriers_without_changing_luminance() {
    let (hidden, expected) = stealth_image();
    let source = DynamicImage::ImageRgba8(hidden).to_luma_alpha8();
    let expected = DynamicImage::ImageRgba8(expected).to_luma_alpha8();
    let bytes = encode(&DynamicImage::ImageLumaA8(source), ImageFormat::Png);
    let exported = export_image(bytes, ImageExportFormat::CleanPng).unwrap();
    assert_eq!(
        image::load_from_memory(&exported.bytes)
            .unwrap()
            .to_luma_alpha8(),
        expected
    );
}

#[test]
fn malformed_stealth_length_erases_the_remaining_carrier() {
    let (mut hidden, _) = stealth_image();
    for position in 15 * 8..19 * 8 {
        hidden.get_pixel_mut(position / 30, position % 30)[3] |= 1;
    }
    let bytes = encode(&DynamicImage::ImageRgba8(hidden), ImageFormat::Png);
    let exported = export_image(bytes, ImageExportFormat::CleanPng).unwrap();
    let cleaned = image::load_from_memory(&exported.bytes).unwrap().to_rgba8();
    assert!(cleaned.pixels().all(|pixel| pixel[3] & 1 == 1));
    assert_eq!(*cleaned.get_pixel(39, 29), Rgba([9, 6, 3, 129]));
}

#[test]
fn jpeg_composites_transparency_on_white_and_omits_source_metadata() {
    let pixels = RgbaImage::from_fn(32, 16, |x, _| {
        if x < 16 {
            Rgba([0, 200, 100, 0])
        } else {
            Rgba([255, 0, 0, 128])
        }
    });
    let source = novelai_bridge::write_png_text_chunks(
        &encode(&DynamicImage::ImageRgba8(pixels), ImageFormat::Png),
        &[novelai_bridge::PngTextEntry::new(
            "Description",
            "private prompt",
        )],
    )
    .unwrap();
    let exported = export_image(source, ImageExportFormat::Jpeg).unwrap();
    assert_eq!(exported.mime_type, "image/jpeg");
    let rgb_pixels = image::load_from_memory(&exported.bytes).unwrap().to_rgb8();
    for (x, expected) in [(4, [255_u8; 3]), (24, [255, 127, 127])] {
        for (actual, expected) in rgb_pixels.get_pixel(x, 8).0.into_iter().zip(expected) {
            assert!(actual.abs_diff(expected) <= 3);
        }
    }
    assert!(
        novelai_bridge::parse_image_metadata_from_bytes(&exported.bytes)
            .unwrap()
            .is_empty()
    );
    let mut decoder = ImageReader::new(Cursor::new(exported.bytes))
        .with_guessed_format()
        .unwrap()
        .into_decoder()
        .unwrap();
    assert!(decoder.exif_metadata().unwrap().is_none());
    assert!(decoder.icc_profile().unwrap().is_none());
    assert!(decoder.xmp_metadata().unwrap().is_none());
}

#[test]
fn reencoded_exports_preserve_exif_rotation_and_mirroring_while_original_stays_unchanged() {
    let red = [230, 20, 20];
    let green = [20, 230, 20];
    let blue = [20, 20, 230];
    let yellow = [230, 230, 20];
    let magenta = [230, 20, 230];
    let cyan = [20, 230, 230];
    let colors = [[red, green, blue], [yellow, magenta, cyan]];
    let pixels = image::RgbImage::from_fn(48, 32, |x, y| {
        image::Rgb(colors[usize::try_from(y / 16).unwrap()][usize::try_from(x / 16).unwrap()])
    });
    for (orientation, width, height, expected) in [
        (6_u16, 32, 48, [yellow, red, magenta, green, cyan, blue]),
        (2, 48, 32, [blue, green, red, cyan, magenta, yellow]),
    ] {
        // TIFF IFD0 contains just the SHORT Orientation tag, with no private metadata.
        let mut exif = b"II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0".to_vec();
        exif.extend_from_slice(&orientation.to_le_bytes());
        exif.extend_from_slice(&[0; 6]);
        for source_format in [ImageFormat::Png, ImageFormat::Jpeg] {
            let mut bytes = Vec::new();
            match source_format {
                ImageFormat::Png => {
                    let mut encoder = image::codecs::png::PngEncoder::new(&mut bytes);
                    encoder.set_exif_metadata(exif.clone()).unwrap();
                    encoder
                        .write_image(pixels.as_raw(), 48, 32, image::ExtendedColorType::Rgb8)
                        .unwrap();
                },
                ImageFormat::Jpeg => {
                    let mut encoder = JpegEncoder::new_with_quality(&mut bytes, 100);
                    encoder.set_exif_metadata(exif.clone()).unwrap();
                    encoder.encode_image(&pixels).unwrap();
                },
                _ => unreachable!(),
            }
            let original = export_image(bytes.clone(), ImageExportFormat::Original).unwrap();
            assert_eq!(original.bytes, bytes);
            for format in [ImageExportFormat::CleanPng, ImageExportFormat::Jpeg] {
                let exported = export_image(bytes.clone(), format).unwrap();
                let rgb_pixels = image::load_from_memory(&exported.bytes).unwrap().to_rgb8();
                assert_eq!(rgb_pixels.dimensions(), (width, height));
                for (index, color) in expected.iter().enumerate() {
                    let index = u32::try_from(index).unwrap();
                    let x = (index % (width / 16)) * 16 + 8;
                    let y = (index / (width / 16)) * 16 + 8;
                    for (actual, expected) in rgb_pixels.get_pixel(x, y).0.iter().zip(color) {
                        assert!(actual.abs_diff(*expected) <= 8);
                    }
                }
                assert!(
                    novelai_bridge::parse_image_metadata_from_bytes(&exported.bytes)
                        .unwrap()
                        .is_empty()
                );
            }
        }
    }
}

#[test]
fn export_rejects_non_images_and_truncated_supported_images() {
    let mut truncated = encode(&DynamicImage::new_rgb8(2, 2), ImageFormat::Png);
    truncated.truncate(truncated.len() / 2);
    for format in [
        ImageExportFormat::Original,
        ImageExportFormat::CleanPng,
        ImageExportFormat::Jpeg,
    ] {
        for bytes in [
            Vec::new(),
            b"not an image".to_vec(),
            b"GIF89a".to_vec(),
            truncated.clone(),
        ] {
            assert!(matches!(
                export_image(bytes, format),
                Err(PersistenceError::Failure { .. })
            ));
        }
    }
}
