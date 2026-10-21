use super::*;

#[test]
fn full_sparse_settings_preserve_explicit_false_and_zero_seed() {
    let mut definition = preset(
        "recipe",
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
        presets: vec![instance("use", "recipe", vec![])],
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
fn character_overrides_and_sources_survive_preset_expansion() {
    let mut definition = preset("recipe", vec![], vec![], GenerationSettings::default());
    let ResourceContent::Preset { characters, .. } = &mut definition.content else {
        unreachable!()
    };
    characters.push(CharacterComposition {
        id: "hero".into(),
        enabled: true,
        position: novelai_bridge::CharacterPosition { x: 0.2, y: 0.8 },
        composition: Composition {
            positive: vec![chunk_node("hero-prompt", "shared")],
            negative: vec![text("hero-negative", "blur")],
        },
    });
    let resources = Resources::new(vec![definition, chunk("shared", "original")]);
    let linked = instance(
        "use",
        "recipe",
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
    let mut definition = preset("recipe", vec![], vec![], GenerationSettings::default());
    let ResourceContent::Preset { characters, .. } = &mut definition.content else {
        unreachable!()
    };
    characters.push(CharacterComposition {
        id: "hero".into(),
        enabled: false,
        position: novelai_bridge::CharacterPosition::default(),
        composition: Composition {
            positive: vec![chunk_node("hero-node", "missing")],
            negative: vec![],
        },
    });
    let resources = Resources::new(vec![definition]);
    let linked = instance("use", "recipe", vec![]);
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
    let mut definition = preset("recipe", vec![], vec![], GenerationSettings::default());
    let ResourceContent::Preset { references, .. } = &mut definition.content else {
        unreachable!()
    };
    references.vibes.push(crate::session::VibeReferenceInput {
        id: "ref".into(),
        enabled: true,
        asset_id: "stable-asset".into(),
        strength: 0.4,
    });
    let resolved = resolve_draft(
        &Draft {
            presets: vec![
                instance("one", "recipe", vec![]),
                instance("two", "recipe", vec![]),
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
        Some("one")
    );
    assert_eq!(
        resolved.input_sources[1].resource_id.as_deref(),
        Some("recipe")
    );
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
    let metadata = novelai_bridge::PngMetadata {
        prompt: Some("portrait, masterpiece".into()),
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
}

#[test]
fn typed_output_overrides_detach_enabled_position_and_asset_choices() {
    let mut definition = preset("recipe", vec![], vec![], GenerationSettings::default());
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
        });
    let mut linked = instance("use", "recipe", vec![]);
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
    });
    let resources = Resources::new(vec![definition.clone()]);
    let mut draft = Draft {
        presets: vec![linked.clone()],
        ..Draft::default()
    };
    let resolved = resolve_draft(&draft, &resources).unwrap();
    assert_eq!(resolved.characters[0].positive, "hero");
    assert!(resolved.characters[0].overridden);
    assert_eq!(resolved.characters[0].position.x, 0.1);
    let reference = &resolved.inputs.references.precise[0];
    assert!(!reference.enabled);
    assert_eq!(reference.asset_id, "replacement");
    assert_eq!(reference.strength, 0.8);
    assert!(resolved.input_sources[0].overridden);
    draft.presets[0] = expand_preset(&linked, &resources).unwrap();
    let expanded = resolve_draft(&draft, &Resources::default()).unwrap();
    assert_eq!(
        expanded.characters[0].position,
        resolved.characters[0].position
    );
    assert_eq!(expanded.inputs.references, resolved.inputs.references);
    assert_eq!(resources.values["recipe"], definition);
}

#[test]
fn removed_output_override_targets_block_expansion() {
    let mut linked = instance("use", "recipe", vec![]);
    let PresetBinding::Linked {
        output_overrides, ..
    } = &mut linked.binding
    else {
        unreachable!()
    };
    output_overrides.vibes.push(VibeReferenceOverride {
        id: "removed".into(),
        enabled: Some(false),
        asset_id: None,
        strength: None,
    });
    let resources = Resources::new(vec![preset(
        "recipe",
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
