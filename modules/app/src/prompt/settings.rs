//! Sparse application overrides; defaults and legal values belong to the SDK.
use novelai_bridge::{
    AlphaMode, GenerateImageRequest, ImageFormat, ImageResponseFormat, ImageSize, Model,
    NoiseSchedule, QualityPreset, Sampler, UcPreset,
};
use serde::{Deserialize, Serialize};

use super::{SettingSource, SettingsProvenance};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct GenerationSettings {
    #[cfg_attr(feature = "typegen", ts(type = "string | null"))]
    pub model: Option<Model>,
    #[cfg_attr(
        feature = "typegen",
        ts(type = "{ width: number; height: number } | null")
    )]
    pub size: Option<ImageSize>,
    pub steps: Option<u32>,
    pub scale: Option<f32>,
    #[cfg_attr(feature = "typegen", ts(type = "string | null"))]
    pub sampler: Option<Sampler>,
    #[cfg_attr(feature = "typegen", ts(type = "number | null"))]
    pub seed: Option<i64>,
    pub n_samples: Option<u32>,
    #[cfg_attr(feature = "typegen", ts(type = "string | null"))]
    pub quality: Option<QualityPreset>,
    #[cfg_attr(feature = "typegen", ts(type = "string | null"))]
    pub uc_preset: Option<UcPreset>,
    pub legacy_uc: Option<bool>,
    pub transparent_background: Option<bool>,
    pub furry_mode: Option<bool>,
    #[cfg_attr(feature = "typegen", ts(type = "string | null"))]
    pub noise_schedule: Option<NoiseSchedule>,
    pub cfg_rescale: Option<f32>,
    pub variety_boost: Option<bool>,
    pub decrisp: Option<bool>,
    pub smea: Option<bool>,
    pub smea_dyn: Option<bool>,
    #[cfg_attr(feature = "typegen", ts(type = "string | null"))]
    pub image_format: Option<ImageFormat>,
    #[cfg_attr(
        feature = "typegen",
        ts(type = "\"straight\" | \"premultiplied\" | null")
    )]
    pub alpha_mode: Option<AlphaMode>,
    #[cfg_attr(feature = "typegen", ts(type = "\"zip\" | \"json\" | null"))]
    pub response_format: Option<ImageResponseFormat>,
    pub use_coords: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
#[expect(
    clippy::struct_excessive_bools,
    reason = "SDK generation and guidance options are independent provider switches"
)]
pub struct ResolvedSettings {
    #[cfg_attr(feature = "typegen", ts(type = "string"))]
    pub model: Model,
    #[cfg_attr(feature = "typegen", ts(type = "{ width: number; height: number }"))]
    pub size: ImageSize,
    pub steps: u32,
    pub scale: f32,
    #[cfg_attr(feature = "typegen", ts(type = "string"))]
    pub sampler: Sampler,
    #[cfg_attr(feature = "typegen", ts(type = "number"))]
    pub seed: i64,
    pub n_samples: u32,
    #[cfg_attr(feature = "typegen", ts(type = "string"))]
    pub quality: QualityPreset,
    #[cfg_attr(feature = "typegen", ts(type = "string"))]
    pub uc_preset: UcPreset,
    pub legacy_uc: bool,
    pub transparent_background: bool,
    pub furry_mode: bool,
    #[cfg_attr(feature = "typegen", ts(type = "string"))]
    pub noise_schedule: NoiseSchedule,
    pub cfg_rescale: f32,
    pub variety_boost: bool,
    pub decrisp: bool,
    pub smea: bool,
    pub smea_dyn: bool,
    #[cfg_attr(feature = "typegen", ts(type = "string | null"))]
    pub image_format: Option<ImageFormat>,
    #[cfg_attr(feature = "typegen", ts(type = "\"straight\" | \"premultiplied\""))]
    pub alpha_mode: AlphaMode,
    #[cfg_attr(feature = "typegen", ts(type = "\"zip\" | \"json\""))]
    pub response_format: ImageResponseFormat,
    pub use_coords: Option<bool>,
}

impl GenerationSettings {
    pub(super) fn overlay(
        &mut self,
        values: &Self,
        provenance: &mut SettingsProvenance,
        source: &SettingSource,
    ) {
        if let Some(value) = values.model {
            self.model = Some(value);
            provenance.model = source.clone();
        }
        if let Some(value) = values.size {
            self.size = Some(value);
            provenance.size = source.clone();
        }
        if let Some(value) = values.steps {
            self.steps = Some(value);
            provenance.steps = source.clone();
        }
        if let Some(value) = values.scale {
            self.scale = Some(value);
            provenance.scale = source.clone();
        }
        if let Some(value) = values.sampler {
            self.sampler = Some(value);
            provenance.sampler = source.clone();
        }
        if let Some(value) = values.seed {
            self.seed = Some(value);
            provenance.seed = source.clone();
        }
        if let Some(value) = values.n_samples {
            self.n_samples = Some(value);
            provenance.n_samples = source.clone();
        }
        if let Some(value) = values.quality {
            self.quality = Some(value);
            provenance.quality = source.clone();
        }
        if let Some(value) = values.uc_preset {
            self.uc_preset = Some(value);
            provenance.uc_preset = source.clone();
        }
        if let Some(value) = values.legacy_uc {
            self.legacy_uc = Some(value);
            provenance.legacy_uc = source.clone();
        }
        if let Some(value) = values.transparent_background {
            self.transparent_background = Some(value);
            provenance.transparent_background = source.clone();
        }
        if let Some(value) = values.furry_mode {
            self.furry_mode = Some(value);
            provenance.furry_mode = source.clone();
        }
        if let Some(value) = values.noise_schedule {
            self.noise_schedule = Some(value);
            provenance.noise_schedule = source.clone();
        }
        if let Some(value) = values.cfg_rescale {
            self.cfg_rescale = Some(value);
            provenance.cfg_rescale = source.clone();
        }
        if let Some(value) = values.variety_boost {
            self.variety_boost = Some(value);
            provenance.variety_boost = source.clone();
        }
        if let Some(value) = values.decrisp {
            self.decrisp = Some(value);
            provenance.decrisp = source.clone();
        }
        if let Some(value) = values.smea {
            self.smea = Some(value);
            provenance.smea = source.clone();
        }
        if let Some(value) = values.smea_dyn {
            self.smea_dyn = Some(value);
            provenance.smea_dyn = source.clone();
        }
        if let Some(value) = values.image_format {
            self.image_format = Some(value);
            provenance.image_format = source.clone();
        }
        if let Some(value) = values.alpha_mode {
            self.alpha_mode = Some(value);
            provenance.alpha_mode = source.clone();
        }
        if let Some(value) = values.response_format {
            self.response_format = Some(value);
            provenance.response_format = source.clone();
        }
        if let Some(value) = values.use_coords {
            self.use_coords = Some(value);
            provenance.use_coords = source.clone();
        }
    }

    pub(crate) fn resolve(&self) -> ResolvedSettings {
        let mut request = GenerateImageRequest::builder("", self.model.unwrap_or_default()).build();
        if let Some(value) = self.model {
            request.core.model = value;
        }
        if let Some(value) = self.size {
            request.core.size = value;
        }
        if let Some(value) = self.steps {
            request.sampling.steps = value;
        }
        if let Some(value) = self.scale {
            request.sampling.scale = value;
        }
        if let Some(value) = self.sampler {
            request.sampling.sampler = value;
        }
        if let Some(value) = self.seed {
            request.core.seed = value;
        }
        if let Some(value) = self.n_samples {
            request.core.n_samples = value;
        }
        if let Some(value) = self.quality {
            request.core.quality = value;
        }
        if let Some(value) = self.uc_preset {
            request.core.uc_preset = value;
        }
        if let Some(value) = self.legacy_uc {
            request.core.legacy_uc = value;
        }
        if let Some(value) = self.transparent_background {
            request.core.transparent_background = value;
        }
        if let Some(value) = self.furry_mode {
            request.core.furry_mode = value;
        }
        if let Some(value) = self.noise_schedule {
            request.sampling.noise_schedule = value;
        }
        if let Some(value) = self.cfg_rescale {
            request.sampling.cfg_rescale = value;
        }
        if let Some(value) = self.variety_boost {
            request.guidance.variety_boost = value;
        }
        if let Some(value) = self.decrisp {
            request.guidance.decrisp = value;
        }
        if let Some(value) = self.smea {
            request.guidance.smea = value;
        }
        if let Some(value) = self.smea_dyn {
            request.guidance.smea_dyn = value;
        }
        if let Some(value) = self.image_format {
            request.output.image_format = Some(value);
        }
        if let Some(value) = self.alpha_mode {
            request.output.alpha_mode = value;
        }
        if let Some(value) = self.response_format {
            request.output.response_format = value;
        }
        let mut resolved = ResolvedSettings::from_request(&request);
        resolved.use_coords = self.use_coords;
        resolved
    }
}

impl ResolvedSettings {
    /// Reads the effective SDK values after normalization and seed resolution.
    #[must_use]
    pub fn from_request(request: &GenerateImageRequest) -> Self {
        Self {
            model: request.core.model,
            size: request.core.size,
            steps: request.sampling.steps,
            scale: request.sampling.scale,
            sampler: request.sampling.sampler,
            seed: request.core.seed,
            n_samples: request.core.n_samples,
            quality: request.core.quality,
            uc_preset: request.core.uc_preset,
            legacy_uc: request.core.legacy_uc,
            transparent_background: request.core.transparent_background,
            furry_mode: request.core.furry_mode,
            noise_schedule: request.sampling.noise_schedule,
            cfg_rescale: request.sampling.cfg_rescale,
            variety_boost: request.guidance.variety_boost,
            decrisp: request.guidance.decrisp,
            smea: request.guidance.smea,
            smea_dyn: request.guidance.smea_dyn,
            image_format: request.output.image_format,
            alpha_mode: request.output.alpha_mode,
            response_format: request.output.response_format,
            use_coords: request
                .characters
                .as_ref()
                .and_then(|characters| characters.use_coords),
        }
    }

    /// Applies resolved composition settings to an SDK generation request.
    pub fn apply_to(&self, request: &mut GenerateImageRequest) {
        request.core.model = self.model;
        request.core.size = self.size;
        request.sampling.steps = self.steps;
        request.sampling.scale = self.scale;
        request.sampling.sampler = self.sampler;
        request.core.seed = self.seed;
        request.core.n_samples = self.n_samples;
        request.core.quality = self.quality;
        request.core.uc_preset = self.uc_preset;
        request.core.legacy_uc = self.legacy_uc;
        request.core.transparent_background = self.transparent_background;
        request.core.furry_mode = self.furry_mode;
        request.sampling.noise_schedule = self.noise_schedule;
        request.sampling.cfg_rescale = self.cfg_rescale;
        request.guidance.variety_boost = self.variety_boost;
        request.guidance.decrisp = self.decrisp;
        request.guidance.smea = self.smea;
        request.guidance.smea_dyn = self.smea_dyn;
        request.output.image_format = self.image_format;
        request.output.alpha_mode = self.alpha_mode;
        request.output.response_format = self.response_format;
        if let Some(characters) = &mut request.characters {
            characters.use_coords = self.use_coords;
        } else if self.use_coords.is_some() {
            request.characters = Some(novelai_bridge::CharacterSet {
                use_coords: self.use_coords,
                ..novelai_bridge::CharacterSet::default()
            });
        }
    }

    /// Retains every effective value as an explicit standalone edit.
    #[must_use]
    pub fn explicit(&self) -> GenerationSettings {
        GenerationSettings {
            model: Some(self.model),
            size: Some(self.size),
            steps: Some(self.steps),
            scale: Some(self.scale),
            sampler: Some(self.sampler),
            seed: Some(self.seed),
            n_samples: Some(self.n_samples),
            quality: Some(self.quality),
            uc_preset: Some(self.uc_preset),
            legacy_uc: Some(self.legacy_uc),
            transparent_background: Some(self.transparent_background),
            furry_mode: Some(self.furry_mode),
            noise_schedule: Some(self.noise_schedule),
            cfg_rescale: Some(self.cfg_rescale),
            variety_boost: Some(self.variety_boost),
            decrisp: Some(self.decrisp),
            smea: Some(self.smea),
            smea_dyn: Some(self.smea_dyn),
            image_format: self.image_format,
            alpha_mode: Some(self.alpha_mode),
            response_format: Some(self.response_format),
            use_coords: self.use_coords,
        }
    }
}
