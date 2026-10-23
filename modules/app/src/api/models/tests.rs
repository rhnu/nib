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

#[test]
fn image_to_image_capabilities_use_actual_operation_context_and_sdk_ranges() {
    let submitted = crate::jobs::tests::submission();
    let mut resolved = submitted.resolved().unwrap().clone();
    resolved.settings.model = Model::NaiDiffusion3;
    resolved.inputs.operation = CreationOperation::ImageToImage {
        asset_id: "source".into(),
        strength: 0.7,
        noise: 0.0,
        color_correct: true,
        extra_noise_seed: None,
        add_original_image: true,
        max_enhance: false,
    };
    let capabilities = model_capabilities(&resolved).unwrap();
    assert!(!capabilities.smea);
    let constraints = resolved.settings.model.descriptor().constraints();
    assert_eq!(
        capabilities.ranges.img2img_strength.min,
        f64::from(constraints.img2img_strength.min)
    );
    assert_eq!(
        capabilities.ranges.img2img_strength.max,
        f64::from(constraints.img2img_strength.max)
    );
    assert_eq!(
        capabilities.ranges.img2img_noise.min,
        f64::from(constraints.img2img_noise.min)
    );
    assert_eq!(
        capabilities.ranges.img2img_noise.max,
        f64::from(constraints.img2img_noise.max)
    );
}

#[test]
fn inpainting_projects_conditioning_capability_and_its_distinct_strength_range() {
    let submitted = crate::jobs::tests::submission();
    let mut resolved = submitted.resolved().unwrap().clone();
    resolved.inputs.operation = CreationOperation::Inpainting {
        asset_id: "source".into(),
        mask_asset_id: "mask".into(),
        img2img: None,
        add_original_image: true,
    };
    resolved.settings.model = Model::NaiDiffusion3;
    let v3 = model_capabilities(&resolved).unwrap();
    assert!(v3.inpainting);
    assert!(!v3.inpainting_image_to_image);
    resolved.settings.model = Model::NaiDiffusion5Full;
    let v5 = model_capabilities(&resolved).unwrap();
    assert!(v5.inpainting_image_to_image);
    assert_eq!(v5.ranges.inpaint_strength.max, 1.0);
    assert!(v5.ranges.img2img_strength.max < v5.ranges.inpaint_strength.max);
}

#[test]
fn character_position_hints_follow_sdk_profiles_and_defaults() {
    let v4 = model_defaults_capabilities(Model::NaiDiffusion45Full, None);
    assert_eq!(v4.character_positioning.as_deref(), Some("grid5x5"));
    assert_eq!(
        v4.character_position_options.grid_coordinates,
        Some(vec![0.1, 0.3, 0.5, 0.7, 0.9])
    );
    assert_eq!(
        v4.character_position_options.default_position,
        novelai_bridge::CharacterPosition::default()
    );
    assert_eq!(v4.character_position_options.use_coords_default, None);
    let v5 = model_defaults_capabilities(Model::NaiDiffusion5Full, None);
    assert_eq!(v5.character_positioning.as_deref(), Some("freeform"));
    assert!(v5.character_position_options.grid_coordinates.is_none());
    assert!(v5.max_characters > 0);
    assert!(!v5.can_add_precise_reference);
    assert!(v4.can_add_precise_reference);
    let v3 = model_defaults_capabilities(Model::NaiDiffusion3, None);
    assert_eq!(v3.max_characters, 0);
    assert!(v3.character_positioning.is_none());
}

#[test]
fn precise_reference_hints_do_not_invent_signed_bounds_or_a_count_limit() {
    let capabilities = model_defaults_capabilities(Model::NaiDiffusion5Full, None);
    let options = capabilities.precise_reference_options;
    assert!(options.strength.is_none());
    assert!(options.fidelity.is_none());
    assert!(options.max_references.is_none());
    assert_eq!(options.information_extracted.min, 0.0);
    assert_eq!(options.information_extracted.max, 1.0);
    assert!(
        options
            .reference_types
            .contains(&novelai_bridge::CharacterReferenceType::Costume)
    );
    assert!(
        options
            .reference_types
            .contains(&novelai_bridge::CharacterReferenceType::Delta)
    );
}
