use super::*;

#[test]
fn full_sparse_settings_preserve_explicit_false_and_zero_seed() {
    let mut definition = preset(
        RECIPE_ID,
        vec![],
        vec![],
        GenerationSettings {
            seed: Some(42),
            n_samples: Some(3),
            furry_mode: Some(true),
            variety_boost: Some(true),
            noise_schedule: Some(novelai_bridge::NoiseSchedule::Native),
            ..GenerationSettings::default()
        },
    );
    definition.name = "Full defaults".into();
    let draft = Draft {
        presets: vec![instance("use", RECIPE_ID, vec![])],
        settings: GenerationSettings {
            seed: Some(0),
            furry_mode: Some(false),
            ..GenerationSettings::default()
        },
        ..Draft::default()
    };
    let resolved = resolve_draft(&draft, &Resources::new(vec![definition])).unwrap();
    let request = resolved.generation_request();
    assert_eq!(request.core.seed, 0);
    assert_eq!(request.core.n_samples, 3);
    assert!(!request.core.furry_mode);
    assert!(request.guidance.variety_boost);
    assert_eq!(resolved.provenance.seed, SettingSource::Draft);
    assert_eq!(
        ResolvedSettings::from_request(&request)
            .explicit()
            .n_samples,
        Some(3)
    );
}

#[test]
fn output_settings_and_legacy_uc_keep_precedence_sources_and_standalone_values() {
    use novelai_bridge::{AlphaMode, ImageResponseFormat};

    let definition = preset(
        RECIPE_ID,
        vec![],
        vec![],
        GenerationSettings {
            model: Some(Model::NaiDiffusion4Full),
            legacy_uc: Some(true),
            alpha_mode: Some(AlphaMode::Premultiplied),
            response_format: Some(ImageResponseFormat::Json),
            ..GenerationSettings::default()
        },
    );
    let draft = Draft {
        presets: vec![instance("use", RECIPE_ID, vec![])],
        settings: GenerationSettings {
            legacy_uc: Some(false),
            alpha_mode: Some(AlphaMode::Straight),
            ..GenerationSettings::default()
        },
        ..Draft::default()
    };
    let resolved = resolve_draft(&draft, &Resources::new(vec![definition])).unwrap();
    let request = resolved.generation_request();
    assert!(!request.core.legacy_uc);
    assert_eq!(request.output.alpha_mode, AlphaMode::Straight);
    assert_eq!(request.output.response_format, ImageResponseFormat::Json);
    assert_eq!(resolved.provenance.legacy_uc, SettingSource::Draft);
    assert_eq!(resolved.provenance.alpha_mode, SettingSource::Draft);
    assert!(matches!(
        &resolved.provenance.response_format,
        SettingSource::Preset { preset_instance_id, .. } if preset_instance_id == "use"
    ));
    let explicit = ResolvedSettings::from_request(&request).explicit();
    assert_eq!(explicit.legacy_uc, Some(false));
    assert_eq!(explicit.alpha_mode, Some(AlphaMode::Straight));
    assert_eq!(explicit.response_format, Some(ImageResponseFormat::Json));
    let restored = resolve_draft(
        &Draft {
            settings: explicit,
            ..Draft::default()
        },
        &Resources::default(),
    )
    .unwrap();
    assert_eq!(restored.generation_request(), request);
}

#[test]
fn absent_overrides_take_defaults_from_each_sdk_model() {
    for model in Model::ALL {
        let resolved = resolve_draft(
            &Draft {
                settings: GenerationSettings {
                    model: Some(model),
                    ..GenerationSettings::default()
                },
                ..Draft::default()
            },
            &Resources::default(),
        )
        .unwrap();
        let sdk_defaults = novelai_bridge::GenerateImageRequest::builder("", model).build();
        assert_eq!(resolved.settings.quality, sdk_defaults.core.quality);
        assert_eq!(resolved.settings.uc_preset, sdk_defaults.core.uc_preset);
        assert_eq!(resolved.settings.sampler, sdk_defaults.sampling.sampler);
        assert_eq!(resolved.settings.alpha_mode, sdk_defaults.output.alpha_mode);
        assert_eq!(
            resolved.settings.response_format,
            sdk_defaults.output.response_format
        );
        assert_eq!(resolved.provenance.quality, SettingSource::SdkDefault);
        assert_eq!(resolved.provenance.uc_preset, SettingSource::SdkDefault);
    }
}

#[test]
fn new_model_capabilities_project_sdk_controls_and_reference_paths() {
    let resolve_model = |model| {
        resolve_draft(
            &Draft {
                settings: GenerationSettings {
                    model: Some(model),
                    ..GenerationSettings::default()
                },
                ..Draft::default()
            },
            &Resources::default(),
        )
        .unwrap()
    };
    let medium =
        crate::api::model_capabilities(&resolve_model(Model::NaiDiffusion5FullMedium)).unwrap();
    assert!(!medium.custom_negative_prompts);
    assert_eq!(medium.fixed_sampler, Some(Sampler::KEulerAncestral));
    let curated =
        crate::api::model_capabilities(&resolve_model(Model::NaiDiffusion5Curated)).unwrap();
    assert!(curated.custom_negative_prompts);
    assert!(curated.max_enhance);
    assert!(curated.inpainting_image_to_image);
    let v3 = crate::api::model_capabilities(&resolve_model(Model::NaiDiffusion3)).unwrap();
    assert_eq!(v3.vibe_input_path.as_deref(), Some("image"));
    assert!(v3.can_add_vibe_reference);
    assert!(!v3.encode_vibe);
}

#[test]
fn character_overrides_and_sources_survive_preset_expansion() {
    let mut definition = preset(RECIPE_ID, vec![], vec![], GenerationSettings::default());
    let ResourceContent::Preset { characters, .. } = &mut definition.content else {
        unreachable!()
    };
    characters.push(CharacterComposition {
        id: "hero".into(),
        enabled: true,
        position: novelai_bridge::CharacterPosition { x: 0.2, y: 0.8 },
        composition: Composition {
            positive: vec![chunk_node("hero-prompt", SHARED_ID)],
            negative: vec![text("hero-negative", "blur")],
        },
    });
    let resources = Resources::new(vec![definition, chunk(SHARED_ID, "original")]);
    let linked = instance(
        "use",
        RECIPE_ID,
        vec![InstanceOverride {
            node_id: "hero-prompt".into(),
            enabled: None,
            text: Some("local hero".into()),
        }],
    );
    let mut draft = Draft {
        presets: vec![linked.clone()],
        ..Draft::default()
    };
    let before = resolve_draft(&draft, &resources).unwrap();
    assert_eq!(before.positive, "");
    assert_eq!(before.characters[0].positive, "local hero");
    assert_eq!(before.characters[0].negative, "blur");
    assert!(before.characters[0].fragments[0].overridden);
    draft.presets[0] = expand_preset(&linked, &resources).unwrap();
    let after = resolve_draft(&draft, &Resources::default()).unwrap();
    assert_eq!(after.characters[0].positive, before.characters[0].positive);
    assert_eq!(after.characters[0].position, before.characters[0].position);
    assert!(after.characters[0].expanded);
    assert!(
        after.characters[0]
            .fragments
            .iter()
            .all(|fragment| fragment.resource_id.is_none())
    );
}

#[test]
fn disabled_character_dependency_is_required_for_lossless_expansion() {
    let mut definition = preset(RECIPE_ID, vec![], vec![], GenerationSettings::default());
    let ResourceContent::Preset { characters, .. } = &mut definition.content else {
        unreachable!()
    };
    characters.push(CharacterComposition {
        id: "hero".into(),
        enabled: false,
        position: novelai_bridge::CharacterPosition::default(),
        composition: Composition {
            positive: vec![chunk_node("hero-node", MISSING_ID)],
            negative: vec![],
        },
    });
    let resources = Resources::new(vec![definition]);
    let linked = instance("use", RECIPE_ID, vec![]);
    let resolved = resolve_draft(
        &Draft {
            presets: vec![linked.clone()],
            ..Draft::default()
        },
        &resources,
    )
    .unwrap();
    assert_eq!(resolved.issues, []);
    let ExpansionError::Unresolved { issues } = expand_preset(&linked, &resources).unwrap_err()
    else {
        panic!("missing dependency")
    };
    assert_eq!(issues[0].character_id.as_deref(), Some("hero"));
}

#[test]
fn repeated_preset_reference_outputs_keep_independent_ids_and_sources() {
    let mut definition = preset(RECIPE_ID, vec![], vec![], GenerationSettings::default());
    let ResourceContent::Preset { references, .. } = &mut definition.content else {
        unreachable!()
    };
    references.vibes.push(crate::session::VibeReferenceInput {
        id: "ref".into(),
        enabled: true,
        input: crate::session::VibeInput::Encoded {
            asset_id: "stable-asset".into(),
        },
        strength: 0.4,
    });
    let resolved = resolve_draft(
        &Draft {
            presets: vec![
                instance(ONE_ID, RECIPE_ID, vec![]),
                instance(TWO_ID, RECIPE_ID, vec![]),
            ],
            ..Draft::default()
        },
        &Resources::new(vec![definition]),
    )
    .unwrap();
    assert_ne!(
        resolved.inputs.references.vibes[0].id,
        resolved.inputs.references.vibes[1].id
    );
    assert_eq!(
        resolved.input_sources[0].preset_instance_id.as_deref(),
        Some(ONE_ID)
    );
    assert_eq!(
        resolved.input_sources[1].resource_id.as_deref(),
        Some(RECIPE_ID)
    );
}

fn identity_preset(resource_id: &str, local_id: &str) -> Resource {
    let mut definition = preset(resource_id, vec![], vec![], GenerationSettings::default());
    let ResourceContent::Preset {
        characters,
        references,
        ..
    } = &mut definition.content
    else {
        unreachable!()
    };
    characters.push(CharacterComposition {
        id: local_id.into(),
        enabled: true,
        position: novelai_bridge::CharacterPosition::default(),
        composition: Composition {
            positive: vec![text("role-text", "hero")],
            negative: vec![],
        },
    });
    references
        .precise
        .push(crate::session::PreciseReferenceInput {
            id: local_id.into(),
            enabled: true,
            asset_id: "stable-image".into(),
            reference_type: novelai_bridge::CharacterReferenceType::Character,
            strength: 1.0,
            fidelity: 1.0,
            information_extracted: 1.0,
        });
    references.vibes.push(crate::session::VibeReferenceInput {
        id: format!("{local_id}:v"),
        enabled: true,
        input: crate::session::VibeInput::Encoded {
            asset_id: "stable-vibe".into(),
        },
        strength: 0.5,
    });
    definition
}

#[test]
fn output_namespaces_keep_colons_and_json_shaped_direct_identities_unambiguous() {
    let first = identity_preset(FIRST_ID, "b:c");
    let second = identity_preset(SECOND_ID, "c");
    let ResourceContent::Preset {
        mut characters,
        mut references,
        ..
    } = identity_preset(UNUSED_ID, "direct").content
    else {
        unreachable!()
    };
    characters[0].id = r#"["a","b:c"]"#.into();
    references.precise[0].id = r#"["a","b:c"]"#.into();
    references.vibes[0].id = r#"["a","b:c:v"]"#.into();
    let draft = Draft {
        presets: vec![
            instance("a", FIRST_ID, vec![]),
            instance("a:b", SECOND_ID, vec![]),
        ],
        characters,
        inputs: crate::session::CreationInputs {
            references,
            ..Default::default()
        },
        ..Draft::default()
    };
    validate_draft(&draft).unwrap();
    let resolved = resolve_draft(&draft, &Resources::new(vec![first, second])).unwrap();
    assert_eq!(resolved.characters[0].id, r#"["a","b:c"]"#);
    assert_eq!(resolved.characters[1].id, r#"["a:b","c"]"#);
    let character_ids: std::collections::HashSet<_> =
        resolved.characters.iter().map(|value| &value.id).collect();
    assert_eq!(character_ids.len(), 3);
    let reference_ids: std::collections::HashSet<_> = resolved
        .inputs
        .references
        .precise
        .iter()
        .map(|value| &value.id)
        .chain(
            resolved
                .inputs
                .references
                .vibes
                .iter()
                .map(|value| &value.id),
        )
        .collect();
    assert_eq!(reference_ids.len(), 6);
    for (index, expected_scope) in [Some("a"), Some("a:b"), None].into_iter().enumerate() {
        let reference = &resolved.inputs.references.precise[index];
        let source = resolved
            .input_sources
            .iter()
            .find(|source| source.id == reference.id)
            .unwrap();
        assert_eq!(source.preset_instance_id.as_deref(), expected_scope);
        let identity: (Option<String>, String) = serde_json::from_str(&reference.id).unwrap();
        assert_eq!(identity.0.as_deref(), expected_scope);
        assert_eq!(resolved.characters[index].id, reference.id);
    }
    let (direct_scope, direct_local): (Option<String>, String) =
        serde_json::from_str(&resolved.characters[2].id).unwrap();
    assert_eq!(direct_scope, None);
    assert_eq!(direct_local, r#"["a","b:c"]"#);
}

#[test]
fn restoration_keeps_conditioning_once_and_never_invents_metadata_positions() {
    let request = novelai_bridge::GenerateImageRequest::builder("portrait", Model::default())
        .negative_prompt("blur")
        .seed(42)
        .build();
    let restored =
        crate::session::restore_generation(&request, crate::session::CreationInputs::default());
    let resolved = resolve_draft(&restored, &Resources::default()).unwrap();
    let second = resolved.generation_request();
    assert_eq!(second.core, request.core);
    let metadata = novelai_bridge::ImageMetadata {
        prompt: Some("portrait, masterpiece".into()),
        negative_prompt: Some("blur, low quality".into()),
        quality_toggle: Some(true),
        uc_preset: Some(0),
        characters: vec![novelai_bridge::CharacterMetadata {
            source_index: 0,
            prompt: Some("hero".into()),
            negative_prompt: None,
        }],
        ..Default::default()
    };
    let metadata_draft = crate::session::draft_from_metadata(&metadata);
    assert_eq!(metadata_draft.characters, []);
    assert_eq!(
        metadata_draft.settings.quality,
        Some(novelai_bridge::QualityPreset::None)
    );
    assert_eq!(
        metadata_draft.settings.uc_preset,
        Some(novelai_bridge::UcPreset::None)
    );
    let metadata_resolved = resolve_draft(&metadata_draft, &Resources::default()).unwrap();
    let normalized = metadata_resolved.generation_request().normalize().unwrap();
    assert_eq!(
        normalized.resolved_prompts().prompt,
        "portrait, masterpiece"
    );
    assert_eq!(
        normalized.resolved_prompts().negative_prompt,
        "blur, low quality"
    );
}

#[test]
fn typed_output_overrides_detach_enabled_position_and_asset_choices() {
    let mut definition = preset(RECIPE_ID, vec![], vec![], GenerationSettings::default());
    let ResourceContent::Preset {
        characters,
        references,
        ..
    } = &mut definition.content
    else {
        unreachable!()
    };
    characters.push(CharacterComposition {
        id: "hero".into(),
        enabled: false,
        position: novelai_bridge::CharacterPosition::default(),
        composition: Composition {
            positive: vec![text("hero-node", "hero")],
            negative: vec![],
        },
    });
    references
        .precise
        .push(crate::session::PreciseReferenceInput {
            id: "portrait".into(),
            enabled: true,
            asset_id: "original".into(),
            reference_type: novelai_bridge::CharacterReferenceType::Character,
            strength: 0.4,
            fidelity: 0.5,
            information_extracted: 1.0,
        });
    references.vibes.push(crate::session::VibeReferenceInput {
        id: "style".into(),
        enabled: true,
        input: crate::session::VibeInput::Encoded {
            asset_id: "encoded".into(),
        },
        strength: 0.5,
    });
    references.normalize_vibe_strength = Some(true);
    let mut linked = instance("use", RECIPE_ID, vec![]);
    let PresetBinding::Linked {
        output_overrides, ..
    } = &mut linked.binding
    else {
        unreachable!()
    };
    output_overrides.characters.push(CharacterOutputOverride {
        character_id: "hero".into(),
        enabled: Some(true),
        position: Some(novelai_bridge::CharacterPosition { x: 0.1, y: 0.9 }),
    });
    output_overrides.precise.push(PreciseReferenceOverride {
        id: "portrait".into(),
        enabled: Some(false),
        asset_id: Some("replacement".into()),
        reference_type: None,
        strength: Some(0.8),
        fidelity: Some(0.7),
        information_extracted: Some(0.6),
    });
    output_overrides.vibes.push(VibeReferenceOverride {
        id: "style".into(),
        enabled: None,
        input: Some(crate::session::VibeInput::Image {
            asset_id: "raw-style".into(),
            information_extracted: 0.7,
        }),
        strength: None,
    });
    output_overrides.normalize_vibe_strength = Some(false);
    let resources = Resources::new(vec![definition.clone()]);
    let mut draft = Draft {
        presets: vec![linked.clone()],
        ..Draft::default()
    };
    let resolved = resolve_draft(&draft, &resources).unwrap();
    assert_eq!(resolved.characters[0].positive, "hero");
    assert!(resolved.characters[0].overridden);
    assert_eq!(resolved.characters[0].position.x, 0.1);
    let references = &resolved.inputs.references;
    let reference = &references.precise[0];
    assert!(!reference.enabled);
    assert_eq!(reference.asset_id, "replacement");
    assert_eq!(reference.strength, 0.8);
    assert_eq!(reference.information_extracted, 0.6);
    assert_eq!(references.normalize_vibe_strength, Some(false));
    assert_eq!(
        references.vibes[0].input,
        crate::session::VibeInput::Image {
            asset_id: "raw-style".into(),
            information_extracted: 0.7,
        }
    );
    assert!(resolved.input_sources[0].overridden);
    draft.presets[0] = expand_preset(&linked, &resources).unwrap();
    let expanded = resolve_draft(&draft, &Resources::default()).unwrap();
    assert_eq!(
        expanded.characters[0].position,
        resolved.characters[0].position
    );
    assert_eq!(expanded.inputs.references, resolved.inputs.references);
}

#[test]
fn removed_output_override_targets_block_expansion() {
    let mut linked = instance("use", RECIPE_ID, vec![]);
    let PresetBinding::Linked {
        output_overrides, ..
    } = &mut linked.binding
    else {
        unreachable!()
    };
    output_overrides.vibes.push(VibeReferenceOverride {
        id: "removed".into(),
        enabled: Some(false),
        input: None,
        strength: None,
    });
    let resources = Resources::new(vec![preset(
        RECIPE_ID,
        vec![],
        vec![],
        GenerationSettings::default(),
    )]);
    let resolved = resolve_draft(
        &Draft {
            presets: vec![linked.clone()],
            ..Draft::default()
        },
        &resources,
    )
    .unwrap();
    assert_eq!(resolved.issues[0].kind, ResolutionIssueKind::StaleOverride);
    assert_eq!(resolved.issues[0].node_id.as_deref(), Some("removed"));
    assert!(matches!(
        expand_preset(&linked, &resources),
        Err(ExpansionError::Unresolved { .. })
    ));
}
