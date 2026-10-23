//! Materialize selected document inputs for an explicit Vibe reencoding request.

use novelai_bridge::{EncodedImage, VibeFile};

use super::encoding_model;
use crate::{
    media::{AssetSource, MediaLibrary},
    persistence::PersistenceError,
    session::VibeEncodingInput,
};

impl MediaLibrary {
    /// Materializes retained source content only after an explicit request to edit encoding.
    ///
    /// # Errors
    /// Returns unavailable source media, unrecognized model identity or invalid embedded images.
    pub fn prepare_vibe_reencoding(&self, id: &str) -> Result<VibeEncodingInput, PersistenceError> {
        let asset = self.asset(id)?;
        self.vibe_content(&asset)?;
        let (view, file) = self.inspect_vibe_source(&asset)?;
        if let Some(input) = view.encoding_input {
            return Ok(input);
        }
        let file = file.ok_or_else(|| PersistenceError::InvalidData {
            message: "编码未保留可用原图，无法重新编码。".to_owned(),
        })?;
        let material = reencoding_material(
            &file,
            view.model_key.as_deref(),
            view.parameter_key.as_deref(),
        )?;
        let request =
            novelai_bridge::EncodeVibeRequest::new(material.image.clone(), material.model);
        let image = self.retain_image(&material.image, asset.source)?;
        let mask = material
            .mask
            .map(|mask| {
                self.retain_image(
                    &mask,
                    AssetSource::Asset {
                        asset_id: id.to_owned(),
                    },
                )
            })
            .transpose()?;
        let mut input = VibeEncodingInput {
            asset_id: image.id,
            model: request.model,
            information_extracted: request.information_extracted,
            mask_asset_id: None,
            crop_to_mask: request.crop_to_mask,
            focus_seed: request.focus_seed,
            info_extract_seed: request.info_extract_seed,
        };
        if let Some(extraction) = material.information_extracted {
            input.information_extracted = extraction;
        }
        input.mask_asset_id = mask.map(|asset| asset.id);
        Ok(input)
    }
}

struct ReencodingMaterial {
    model: novelai_bridge::Model,
    image: EncodedImage,
    mask: Option<EncodedImage>,
    information_extracted: Option<f32>,
}

fn reencoding_material(
    file: &VibeFile,
    model_key: Option<&str>,
    parameter_key: Option<&str>,
) -> Result<ReencodingMaterial, PersistenceError> {
    let model = encoding_model(model_key).ok_or_else(|| PersistenceError::InvalidData {
        message: "编码的模型身份没有对应的 SDK 编码能力，请另行选择原图和模型。".to_owned(),
    })?;
    let image = file
        .image
        .as_deref()
        .ok_or_else(|| PersistenceError::InvalidData {
            message: "Vibe 文档没有原图，无法重新编码。".to_owned(),
        })?;
    let image = EncodedImage::from_base64(image).map_err(|error| {
        PersistenceError::failure("decode the retained Vibe source image", error)
    })?;
    let record = model_key
        .and_then(|key| file.encodings.get(key))
        .and_then(|records| parameter_key.and_then(|key| records.get(key)))
        .ok_or_else(|| PersistenceError::InvalidData {
            message: "Vibe 文档缺少所选编码缓存。".to_owned(),
        })?;
    let params = record.params.as_ref();
    let mask = params
        .and_then(|params| params.mask.as_deref())
        .map(EncodedImage::from_base64)
        .transpose()
        .map_err(|error| PersistenceError::failure("decode the retained Vibe mask", error))?;
    let information_extracted: Option<f32> = params
        .and_then(|params| params.information_extracted)
        .map(|value| serde_json::from_value(serde_json::json!(value)))
        .transpose()
        .map_err(|error| {
            PersistenceError::failure("read Vibe extraction for the SDK encoder", error)
        })?;
    if information_extracted.is_some_and(|value| !value.is_finite()) {
        return Err(PersistenceError::InvalidData {
            message: "文档信息提取量无法表示为编码输入。".to_owned(),
        });
    }
    Ok(ReencodingMaterial {
        model,
        image,
        mask,
        information_extracted,
    })
}

#[cfg(test)]
mod tests;
