use image::{DynamicImage, Rgb, RgbImage, Rgba, RgbaImage};

use super::{ANIME_SIZE, WD_SIZE, anime_tensor, composite_white, decode_rgb, wd_tensor};
use crate::AnalysisError;

#[test]
fn transparent_pixels_are_composited_on_white() {
    let image = DynamicImage::ImageRgba8(RgbaImage::from_fn(3, 1, |x, _| match x {
        0 => Rgba([0, 0, 0, 0]),
        1 => Rgba([0, 0, 0, 128]),
        _ => Rgba([10, 20, 30, 255]),
    }));
    let rgb = composite_white(&image);
    assert_eq!(rgb.get_pixel(0, 0).0, [255, 255, 255]);
    assert_eq!(rgb.get_pixel(1, 0).0, [127, 127, 127]);
    assert_eq!(rgb.get_pixel(2, 0).0, [10, 20, 30]);
}

#[test]
fn anime_tensor_uses_rgb_planes_normalized_to_minus_one_and_one() {
    let input = RgbImage::from_pixel(8, 8, Rgb([255, 0, 255]));
    let tensor = anime_tensor(&input);
    let plane = (ANIME_SIZE * ANIME_SIZE) as usize;
    assert_eq!(tensor.len(), plane * 3);
    assert_eq!(tensor[0], 1.0);
    assert_eq!(tensor[plane], -1.0);
    assert_eq!(tensor[plane * 2], 1.0);
}

#[test]
fn wd_tensor_uses_bgr_channels_and_white_square_padding() {
    let input = RgbImage::from_pixel(4, 8, Rgb([10, 20, 30]));
    let tensor = wd_tensor(&input);
    assert_eq!(tensor.len(), (WD_SIZE * WD_SIZE * 3) as usize);
    assert_eq!(&tensor[..3], &[255.0, 255.0, 255.0]);
    let center = ((WD_SIZE * WD_SIZE / 2 + WD_SIZE / 2) * 3) as usize;
    assert_eq!(&tensor[center..center + 3], &[30.0, 20.0, 10.0]);
}

#[test]
fn decoding_failure_retains_input_classification() {
    assert!(matches!(
        decode_rgb(b"invalid"),
        Err(AnalysisError::InvalidImage(_))
    ));
}
