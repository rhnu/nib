//! Model-specific preprocessing preserves the pinned models' tensor semantics.

use image::{DynamicImage, Rgb, RgbImage, imageops};

use crate::AnalysisError;

pub(crate) const ANIME_SIZE: u32 = 384;
pub(crate) const WD_SIZE: u32 = 448;

pub(crate) fn decode_rgb(bytes: &[u8]) -> Result<RgbImage, AnalysisError> {
    image::load_from_memory(bytes)
        .map(|image| composite_white(&image))
        .map_err(AnalysisError::InvalidImage)
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "alpha-composited byte channels, including rounding, remain between 0 and 255"
)]
fn composite_white(image: &DynamicImage) -> RgbImage {
    let rgba = image.to_rgba8();
    RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let [r, g, b, alpha] = rgba.get_pixel(x, y).0;
        let alpha = u16::from(alpha);
        // The weighted average is bounded by 255, including rounding.
        let blend =
            |channel: u8| ((u16::from(channel) * alpha + 255 * (255 - alpha) + 127) / 255) as u8;
        Rgb([blend(r), blend(g), blend(b)])
    })
}

pub(crate) fn anime_tensor(image: &RgbImage) -> Vec<f32> {
    let resized = imageops::resize(
        image,
        ANIME_SIZE,
        ANIME_SIZE,
        imageops::FilterType::Triangle,
    );
    let plane = (ANIME_SIZE * ANIME_SIZE) as usize;
    let mut tensor = vec![0.0; plane * 3];
    for (index, pixel) in resized.pixels().enumerate() {
        for channel in 0..3 {
            tensor[channel * plane + index] = f32::from(pixel.0[channel]) / 127.5 - 1.0;
        }
    }
    tensor
}

pub(crate) fn wd_tensor(image: &RgbImage) -> Vec<f32> {
    let side = image.width().max(image.height());
    let mut canvas = RgbImage::from_pixel(side, side, Rgb([255, 255, 255]));
    imageops::overlay(
        &mut canvas,
        image,
        i64::from((side - image.width()) / 2),
        i64::from((side - image.height()) / 2),
    );
    let resized = imageops::resize(&canvas, WD_SIZE, WD_SIZE, imageops::FilterType::CatmullRom);
    let mut tensor = Vec::with_capacity((WD_SIZE * WD_SIZE * 3) as usize);
    for pixel in resized.pixels() {
        tensor.extend([
            f32::from(pixel.0[2]),
            f32::from(pixel.0[1]),
            f32::from(pixel.0[0]),
        ]);
    }
    tensor
}

#[cfg(test)]
mod tests;
