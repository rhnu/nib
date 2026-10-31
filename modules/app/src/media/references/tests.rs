use super::*;
use crate::{
    prompt::{
        Composition, GenerationSettings, PreciseReferenceOverride, PresetInstance,
        PresetOutputOverrides, PromptNode, VibeReferenceOverride,
    },
    session::{MaskSession, PngTextSession, VibeInput, VibeReferenceInput},
};

#[test]
fn creation_retains_disabled_materials_overrides_and_separate_editors() {
    let mut draft = Draft::default();
    draft.inputs.operation = CreationOperation::Inpainting {
        asset_id: "image".into(),
        mask_asset_id: "mask".into(),
        img2img: None,
        add_original_image: true,
    };
    draft.inputs.references.vibes.push(VibeReferenceInput {
        id: "reference-row".into(),
        enabled: false,
        input: VibeInput::Encoded {
            asset_id: "disabled-vibe".into(),
        },
        strength: 1.0,
    });
    draft.presets.push(PresetInstance {
        id: "instance".into(),
        enabled: false,
        binding: PresetBinding::Linked {
            resource_id: "resource-only".into(),
            overrides: Vec::new(),
            settings_overrides: GenerationSettings::default(),
            output_overrides: PresetOutputOverrides {
                precise: vec![PreciseReferenceOverride {
                    id: "precise-row".into(),
                    enabled: Some(false),
                    asset_id: Some("override-image".into()),
                    reference_type: None,
                    strength: None,
                    fidelity: None,
                    information_extracted: None,
                }],
                vibes: vec![VibeReferenceOverride {
                    id: "vibe-row".into(),
                    enabled: Some(false),
                    input: Some(VibeInput::Image {
                        asset_id: "override-vibe".into(),
                        information_extracted: 1.0,
                    }),
                    strength: None,
                }],
                ..PresetOutputOverrides::default()
            },
        },
    });
    draft.mask_editor.sessions.push(MaskSession {
        source_asset_id: "editor-image".into(),
        width: 1,
        height: 1,
        base_mask_asset_id: Some("base-mask".into()),
        commands: Vec::new(),
        cursor: 0,
        revision: 0,
        applied_revision: 0,
        applied_mask_asset_id: Some("applied-mask".into()),
        brush_size: 1.0,
        zoom: 1.0,
        pan_x: 0.0,
        pan_y: 0.0,
    });
    draft.vibe_encoder = Some(VibeEncodingInput {
        asset_id: "encoder-image".into(),
        model: novelai_bridge::Model::NaiDiffusion4Full,
        information_extracted: 1.0,
        mask_asset_id: Some("encoder-mask".into()),
        crop_to_mask: None,
        focus_seed: None,
        info_extract_seed: None,
    });
    draft.director.tools[0].asset_id = Some("director-image".into());
    draft.png_text_editor.sessions.push(PngTextSession {
        asset_id: "png-source".into(),
        entries: Vec::new(),
        selected_output_asset_id: Some("png-output".into()),
    });
    draft.composition.positive.push(PromptNode::Text {
        id: "not-media".into(),
        enabled: true,
        text: "text-only".into(),
    });
    assert_eq!(
        creation_ids(&draft),
        BTreeSet::from([
            "image",
            "mask",
            "disabled-vibe",
            "override-image",
            "override-vibe",
            "editor-image",
            "base-mask",
            "applied-mask",
            "encoder-image",
            "encoder-mask",
            "director-image",
            "png-source",
            "png-output"
        ])
    );
}

#[test]
fn expanded_disabled_preset_retains_media_but_text_and_resource_ids_are_not_media() {
    let mut draft = Draft::default();
    draft.presets.push(PresetInstance {
        id: "instance".into(),
        enabled: false,
        binding: PresetBinding::Expanded {
            name: "name-only".into(),
            composition: Composition::default(),
            defaults: GenerationSettings::default(),
            characters: Vec::new(),
            references: ReferenceInputs {
                vibes: vec![VibeReferenceInput {
                    id: "row-only".into(),
                    enabled: false,
                    input: VibeInput::Image {
                        asset_id: "retained".into(),
                        information_extracted: 1.0,
                    },
                    strength: 1.0,
                }],
                ..ReferenceInputs::default()
            },
        },
    });
    assert_eq!(creation_ids(&draft), BTreeSet::from(["retained"]));
}

#[test]
fn source_dependencies_exclude_historical_resource_and_job_identifiers() {
    assert!(
        source_ids(&AssetSource::ResourceCover {
            resource_id: "resource".into()
        })
        .is_empty()
    );
    assert!(
        source_ids(&AssetSource::Job {
            job_id: "job".into()
        })
        .is_empty()
    );
    assert!(
        source_ids(&AssetSource::Import {
            name: Some("text-only".into())
        })
        .is_empty()
    );
    assert_eq!(
        source_ids(&AssetSource::Asset {
            asset_id: "source".into()
        }),
        BTreeSet::from(["source"])
    );
    assert_eq!(
        source_ids(&AssetSource::PngVibeDocument {
            image_asset_id: "image".into(),
            document_asset_id: "document".into()
        }),
        BTreeSet::from(["document", "image"])
    );
    assert_eq!(
        source_ids(&AssetSource::VibeBundle {
            asset_ids: vec!["one".into(), "two".into(), "one".into()]
        }),
        BTreeSet::from(["one", "two"])
    );
}

#[test]
fn job_encoder_retains_source_and_optional_mask() {
    let submission = FrozenSubmission::EncodeVibe {
        asset_id: "source".into(),
        policy: novelai_bridge::ValidationPolicy::default(),
        diagnostics: Vec::new(),
        model: novelai_bridge::Model::NaiDiffusion4Full,
        information_extracted: 1.0,
        mask_asset_id: Some("mask".into()),
        crop_to_mask: None,
        focus_seed: None,
        info_extract_seed: None,
    };
    assert_eq!(job_ids(&submission), BTreeSet::from(["source", "mask"]));
}

#[test]
fn resource_collects_cover_and_preset_materials_without_treating_text_as_media() {
    let mut resource = Resource {
        id: "resource".into(),
        revision: 0,
        name: "name-only".into(),
        description: "text-only".into(),
        aliases: Vec::new(),
        tags: Vec::new(),
        models: Vec::new(),
        folder_id: None,
        cover_asset_id: Some("cover".into()),
        created_at: 0,
        updated_at: 0,
        content: ResourceContent::Chunk {
            text: "text-only".into(),
        },
    };
    assert_eq!(resource_ids(&resource), BTreeSet::from(["cover"]));
    resource.content = ResourceContent::Preset {
        composition: Composition::default(),
        defaults: GenerationSettings::default(),
        characters: Vec::new(),
        references: ReferenceInputs {
            vibes: vec![VibeReferenceInput {
                id: "row".into(),
                enabled: false,
                input: VibeInput::Encoded {
                    asset_id: "vibe".into(),
                },
                strength: 1.0,
            }],
            ..ReferenceInputs::default()
        },
    };
    assert_eq!(resource_ids(&resource), BTreeSet::from(["cover", "vibe"]));
}
