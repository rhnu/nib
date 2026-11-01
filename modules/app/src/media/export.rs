//! In-memory image delivery, preserving originals or removing private metadata.

use std::io::Cursor;

use image::{
    DynamicImage, ImageDecoder as _, ImageFormat, ImageReader, RgbImage, codecs::jpeg::JpegEncoder,
    metadata::Orientation,
};
use serde::{Deserialize, Serialize};

use super::MediaContent;
use crate::persistence::PersistenceError;

/// Export policy is independent from the stored asset's original format.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum ImageExportFormat {
    Original,
    CleanPng,
    Jpeg,
}

/// Validates supported media and returns bytes ready to save without changing the asset.
///
/// # Errors
/// Returns malformed/unsupported media, SDK resource-budget or encoding failures.
pub fn export_image(
    bytes: Vec<u8>,
    format: ImageExportFormat,
) -> Result<MediaContent, PersistenceError> {
    let image = novelai_bridge::EncodedImage::from_bytes(bytes)
        .map_err(|error| PersistenceError::failure("decode image for export", error))?;
    if format == ImageExportFormat::Original {
        let original_format = image::guess_format(image.as_bytes())
            .map_err(|error| PersistenceError::failure("identify image for export", error))?;
        return Ok(MediaContent {
            mime_type: original_format.to_mime_type().to_owned(),
            bytes: image.as_bytes().to_vec(),
        });
    }
    let orientation = source_orientation(image.as_bytes())?;
    let mut pixels = image.pixels().clone();
    drop(image);
    // The alpha carrier uses original pixel coordinates. Erase it before rotating or mirroring.
    erase_stealth_metadata(&mut pixels);
    pixels.apply_orientation(orientation);
    let mut encoded = Vec::new();
    let mime_type = match format {
        ImageExportFormat::CleanPng => {
            // Encoding pixels alone copies no PNG text, Exif, profiles or embedded documents.
            // DynamicImage retains native channel depth, including genuine 16-bit alpha.
            pixels
                .write_to(&mut Cursor::new(&mut encoded), ImageFormat::Png)
                .map_err(|error| PersistenceError::failure("encode clean PNG export", error))?;
            "image/png"
        },
        ImageExportFormat::Jpeg => {
            let rgb = composite_white(&pixels);
            JpegEncoder::new_with_quality(&mut encoded, 95)
                .encode_image(&rgb)
                .map_err(|error| PersistenceError::failure("encode JPEG export", error))?;
            "image/jpeg"
        },
        ImageExportFormat::Original => unreachable!("original bytes returned before encoding"),
    };
    tracing::debug!(
        ?format,
        byte_length = encoded.len(),
        "prepared image export"
    );
    Ok(MediaContent {
        mime_type: mime_type.to_owned(),
        bytes: encoded,
    })
}

/// Reads display orientation within the same resource limits used by SDK validation.
fn source_orientation(bytes: &[u8]) -> Result<Orientation, PersistenceError> {
    let policy = novelai_bridge::ImageDecodePolicy::default();
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| PersistenceError::failure("identify image orientation", error))?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(policy.max_width);
    limits.max_image_height = Some(policy.max_height);
    limits.max_alloc = Some(policy.max_decoded_bytes);
    reader.limits(limits);
    reader
        .into_decoder()
        .map_err(|error| PersistenceError::failure("read image orientation", error))?
        .orientation()
        .map_err(|error| PersistenceError::failure("read image orientation", error))
}

/// Removes the confirmed `NovelAI` alpha carrier without interpreting its private contents.
fn erase_stealth_metadata(pixels: &mut DynamicImage) {
    match pixels {
        DynamicImage::ImageRgba8(buffer) => {
            let (width, height) = buffer.dimensions();
            erase_alpha_carrier(buffer.as_mut(), 4, width as usize, height as usize);
        },
        DynamicImage::ImageLumaA8(buffer) => {
            let (width, height) = buffer.dimensions();
            erase_alpha_carrier(buffer.as_mut(), 2, width as usize, height as usize);
        },
        // The SDK confirms this carrier only for 8-bit alpha. Do not guess at 16-bit pixels.
        _ => {},
    }
}

fn erase_alpha_carrier(pixels: &mut [u8], channels: usize, width: usize, height: usize) {
    const SIGNATURE: &[u8] = b"stealth_pngcomp";
    const HEADER_BITS: usize = (SIGNATURE.len() + 4) * 8;
    let capacity = width * height;
    if capacity < HEADER_BITS {
        return;
    }
    // NovelAI stores MSB-first bytes in column-major alpha order, unlike the pixel buffer.
    let alpha_index =
        |bit: usize| ((bit % height) * width + bit / height) * channels + channels - 1;
    let read_byte = |offset: usize| {
        (0..8).fold(0_u8, |value, bit| {
            (value << 1) | (pixels[alpha_index(offset + bit)] & 1)
        })
    };
    if SIGNATURE
        .iter()
        .enumerate()
        .any(|(index, expected)| read_byte(index * 8) != *expected)
    {
        return;
    }
    let payload_bits = u32::from_be_bytes(std::array::from_fn(|index| {
        read_byte((SIGNATURE.len() + index) * 8)
    })) as usize;
    let valid_length = payload_bits != 0
        && payload_bits.is_multiple_of(8)
        && payload_bits <= capacity - HEADER_BITS;
    // A damaged length cannot delimit private bytes. After a confirmed signature, erase the
    // entire available carrier in that case rather than leaving an undiscoverable payload.
    let end = if valid_length {
        HEADER_BITS + payload_bits
    } else {
        capacity
    };
    for bit in 0..end {
        // Restore the low alpha bit, including the full payload, while changing alpha by <= 1.
        pixels[alpha_index(bit)] |= 1;
    }
    tracing::debug!(
        carrier_bits = end,
        valid_length,
        "removed NovelAI stealth metadata"
    );
}

/// JPEG has no alpha channel; composite explicitly so transparent regions become white.
fn composite_white(pixels: &DynamicImage) -> RgbImage {
    if !pixels.color().has_alpha() {
        return pixels.to_rgb8();
    }
    let rgba = pixels.to_rgba8();
    RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let pixel = rgba.get_pixel(x, y);
        let alpha = u32::from(pixel[3]);
        image::Rgb(std::array::from_fn(|channel| {
            let color = u32::from(pixel[channel]);
            u8::try_from((color * alpha + 255 * (255 - alpha) + 127) / 255)
                .expect("a weighted average of 8-bit colors stays within 8 bits")
        }))
    })
}

#[cfg(test)]
mod tests;
