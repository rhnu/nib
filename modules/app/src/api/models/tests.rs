use novelai_bridge::{GenerationField, ImageSize, InvalidRequest};

use super::*;

#[test]
fn fixed_model_options_and_numeric_limits_are_projected_for_the_editor() {
    let capabilities = model_defaults_capabilities(Model::NaiDiffusion5FullMedium, None);
    assert_eq!(capabilities.samplers, vec![Sampler::KEulerAncestral]);
    assert_eq!(capabilities.fixed_sampler, Some(Sampler::KEulerAncestral));
    assert_eq!(capabilities.noise_schedules, vec![NoiseSchedule::Karras]);
    assert_eq!(
        capabilities.fixed_noise_schedule,
        Some(NoiseSchedule::Karras)
    );
    assert_eq!(capabilities.ranges.steps.min, 14.0);
    assert_eq!(capabilities.ranges.steps.max, 14.0);
    assert_eq!(capabilities.ranges.cfg_rescale.max, 0.0);
    assert_eq!(capabilities.defaults.steps, 14);
    assert_eq!(capabilities.defaults.model, Model::NaiDiffusion5FullMedium);
}

#[test]
fn sampling_and_sample_options_use_actual_editor_context() {
    let settings = GenerationSettings {
        sampler: Some(Sampler::KDpm2),
        size: Some(ImageSize {
            width: 2048,
            height: 1536,
        }),
        ..GenerationSettings::default()
    };
    let capabilities = model_defaults_capabilities(Model::NaiDiffusion45Full, Some(settings));
    assert_eq!(
        capabilities.noise_schedules,
        vec![NoiseSchedule::Exponential, NoiseSchedule::Polyexponential]
    );
    assert_eq!(capabilities.ranges.n_samples.max, 4.0);
    // The value used to reset an override remains the SDK default, independent of context.
    assert_eq!(capabilities.defaults.sampler, Sampler::KEulerAncestral);
}

#[test]
fn sdk_rejections_keep_typed_field_locations() {
    let error = InvalidRequest::NumericOutOfRange {
        field: GenerationField::Steps.into(),
        value: 0.0,
        min: 1.0,
        max: 50.0,
    };
    assert_eq!(crate::api::request_error_fields(&error), ["sampling.steps"]);
    let error = InvalidRequest::UnsupportedFieldCombination {
        left: GenerationField::TransparentBackground.into(),
        right: GenerationField::FurryMode.into(),
    };
    assert_eq!(
        crate::api::request_error_fields(&error),
        ["core.transparent_background", "core.furry_mode"]
    );
}
