//! Precise-reference selection, pricing, and retained media identities.

use novelai_bridge::{CharacterReferenceType, Model};

use super::*;
use crate::session::{VibeInput, VibeReferenceInput};

#[test]
fn applicable_precise_references_skip_hidden_vibe_media_in_quotes_and_strict_submissions() {
    let (mut queue, unexpected_call) = memory_queue(Arc::new(MemoryJobs::default()), false);
    let queue_mut = Arc::get_mut(&mut queue).unwrap();
    queue_mut.assets = Arc::new(ImageAssets);
    queue_mut.tokenizers = Arc::new(Tokenizers::bundled().unwrap());
    let mut draft = Draft::default();
    draft.settings.model = Some(Model::NaiDiffusion45Full);
    draft.composition.positive.push(PromptNode::Text {
        id: "prompt".into(),
        enabled: true,
        text: "cat".into(),
    });
    draft.inputs.references.precise = vec![crate::session::PreciseReferenceInput {
        id: "precise".into(),
        enabled: true,
        asset_id: "source".into(),
        reference_type: novelai_bridge::CharacterReferenceType::Character,
        strength: 1.0,
        fidelity: 1.0,
        information_extracted: 1.0,
    }];
    draft.inputs.references.vibes = vec![
        VibeReferenceInput {
            id: "missing-encoded".into(),
            enabled: true,
            input: VibeInput::Encoded {
                asset_id: "absent-encoding".into(),
            },
            strength: 1.0,
        },
        VibeReferenceInput {
            id: "missing-image".into(),
            enabled: true,
            input: VibeInput::Image {
                asset_id: "absent-image".into(),
                information_extracted: 1.0,
            },
            strength: 1.0,
        },
    ];
    for policy in [
        novelai_bridge::ValidationPolicy::Normalize,
        novelai_bridge::ValidationPolicy::Reject,
    ] {
        draft.inputs.policy = policy;
        let retained = draft.clone();
        assert!(queue.quote(&draft).unwrap().estimated_anlas.is_some());
        let frozen = queue.freeze(&draft).unwrap();
        assert_eq!(frozen.resolved().unwrap().inputs.references.vibes.len(), 0);
        let hydrated = operations::hydrate(
            request(&frozen).clone(),
            &frozen.resolved().unwrap().inputs,
            &ImageAssets,
        )
        .unwrap();
        let references = hydrated.references.unwrap();
        assert_eq!(references.character_references.len(), 1);
        assert!(references.vibe_transfer.is_none());
        assert_eq!(draft, retained);
    }
    draft.inputs.references.precise[0].enabled = false;
    assert!(matches!(
        queue.quote(&draft),
        Err(JobError::InputMedia { .. })
    ));
    assert!(!unexpected_call.load(Ordering::Acquire));
}

#[test]
fn unsupported_precise_references_do_not_suppress_raw_vibe() {
    let mut inputs = crate::session::CreationInputs::default();
    inputs.references.precise = vec![crate::session::PreciseReferenceInput {
        id: "precise".into(),
        enabled: true,
        asset_id: "source".into(),
        reference_type: novelai_bridge::CharacterReferenceType::Character,
        strength: 1.0,
        fidelity: 1.0,
        information_extracted: 1.0,
    }];
    inputs.references.vibes = vec![VibeReferenceInput {
        id: "vibe".into(),
        enabled: true,
        input: VibeInput::Image {
            asset_id: "source".into(),
            information_extracted: 0.5,
        },
        strength: -0.5,
    }];
    let request =
        novelai_bridge::GenerateImageRequest::builder("cat", Model::NaiDiffusion3).build();
    let normalized = operations::hydrate(request, &inputs, &ImageAssets)
        .unwrap()
        .normalize()
        .unwrap();
    let references = normalized.request().references.as_ref().unwrap();
    assert_eq!(references.character_references.len(), 0);
    assert_eq!(
        references.vibe_transfer.as_ref().unwrap().references.len(),
        1
    );
}

#[test]
fn precise_references_freeze_signed_parameters_and_restore_the_same_assets() {
    let submitted = submission();
    let mut resolved = submitted.resolved().unwrap().clone();
    resolved.settings.model = Model::NaiDiffusion45Full;
    resolved
        .inputs
        .references
        .precise
        .push(crate::session::PreciseReferenceInput {
            id: "reference".into(),
            enabled: true,
            asset_id: "source".into(),
            reference_type: CharacterReferenceType::Style,
            strength: -2.0,
            fidelity: 1.5,
            information_extracted: 1.5,
        });
    let frozen = prepare_submission(resolved, &ImageAssets).unwrap();
    let encoded = sqlite::encode_submission(&frozen).unwrap();
    let reopened = sqlite::decode_submission(&encoded).unwrap();
    let inputs = reopened.resolved().unwrap().inputs.clone();
    let restored = crate::session::restore_generation(request(&reopened), inputs);
    let hydrated =
        operations::hydrate(request(&reopened).clone(), &restored.inputs, &ImageAssets).unwrap();
    let reference = &hydrated.references.as_ref().unwrap().character_references[0];
    assert_eq!(reference.strength.to_bits(), (-2f32).to_bits());
    assert_eq!(reference.fidelity.to_bits(), 1.5_f32.to_bits());
    assert_eq!(reference.information_extracted.to_bits(), 1f32.to_bits());
    assert_eq!(reference.reference_type, CharacterReferenceType::Style);
    assert_eq!(restored.inputs.references.precise[0].asset_id, "source");
    assert!(!encoded.contains("iVBOR"));
}

#[test]
fn precise_reference_indices_skip_disabled_images_and_keep_the_enabled_entry_identity() {
    let submitted = submission();
    let mut resolved = submitted.resolved().unwrap().clone();
    resolved.settings.model = Model::NaiDiffusion45Full;
    let enabled = crate::session::PreciseReferenceInput {
        id: "enabled-reference".into(),
        enabled: true,
        asset_id: "source".into(),
        reference_type: novelai_bridge::CharacterReferenceType::Character,
        strength: 1.0,
        fidelity: 1.0,
        information_extracted: 2.0,
    };
    resolved.inputs.references.precise = vec![
        crate::session::PreciseReferenceInput {
            id: "disabled-reference".into(),
            enabled: false,
            asset_id: "absent-image".into(),
            ..enabled.clone()
        },
        enabled,
    ];
    let frozen = prepare_submission(resolved, &ImageAssets).unwrap();
    let references = &frozen.resolved().unwrap().inputs.references.precise;
    assert_eq!(references.len(), 1);
    assert_eq!(references[0].id, "enabled-reference");
    let sdk_field = novelai_bridge::GenerationField::CharacterReference {
        index: 0,
        field: novelai_bridge::CharacterReferenceField::InformationExtracted,
    }
    .to_string();
    assert!(
        frozen
            .diagnostics()
            .iter()
            .any(|diagnostic| diagnostic.field == sdk_field
                && diagnostic.input_id.as_deref() == Some("enabled-reference"))
    );
}

struct ReferenceAssets;

impl crate::media::AssetReader for ReferenceAssets {
    fn image(&self, _id: &str) -> Result<novelai_bridge::EncodedImage, PersistenceError> {
        ImageAssets.image("source")
    }

    fn vibe(&self, _id: &str) -> Result<novelai_bridge::VibeEncoding, PersistenceError> {
        Ok(novelai_bridge::VibeEncoding::from_bytes(vec![1]).unwrap())
    }
}

fn precise_input(
    id: &str,
    reference_type: CharacterReferenceType,
) -> crate::session::PreciseReferenceInput {
    crate::session::PreciseReferenceInput {
        id: id.to_owned(),
        asset_id: format!("asset-{id}"),
        enabled: true,
        reference_type,
        strength: 1.0,
        fidelity: 1.0,
        information_extracted: 1.0,
    }
}

#[test]
fn filtered_precise_and_vibe_rows_freeze_the_matching_asset_and_diagnostic_identity() {
    let mut precise = submission().resolved().unwrap().clone();
    precise.settings.model = Model::NaiDiffusion45Full;
    precise.inputs.references.precise = vec![
        precise_input("first", CharacterReferenceType::Style),
        precise_input("rest", CharacterReferenceType::Costume),
        precise_input("last", CharacterReferenceType::CharacterMainOutfit),
    ];
    let frozen = prepare_submission(precise, &ReferenceAssets).unwrap();
    let reopened = sqlite::decode_submission(&sqlite::encode_submission(&frozen).unwrap()).unwrap();
    let effective = &reopened.resolved().unwrap().inputs.references.precise;
    assert_eq!(
        effective
            .iter()
            .map(|row| row.asset_id.as_str())
            .collect::<Vec<_>>(),
        ["asset-first", "asset-last"]
    );
    assert_eq!(
        effective[1].reference_type,
        CharacterReferenceType::Character
    );
    assert!(
        reopened
            .diagnostics()
            .iter()
            .any(|item| item.input_id.as_deref() == Some("last")
                && item.change
                    == UserMessage::ReferenceTypeFallback {
                        reference_type: "character".to_owned()
                    })
    );

    let mut vibe = submission().resolved().unwrap().clone();
    vibe.settings.model = Model::NaiDiffusion45Full;
    vibe.inputs.references.vibes = vec![
        VibeReferenceInput {
            id: "encoded-first".to_owned(),
            input: VibeInput::Encoded {
                asset_id: "encoding-first".to_owned(),
            },
            enabled: true,
            strength: 1.0,
        },
        VibeReferenceInput {
            id: "wrong-raw".to_owned(),
            input: VibeInput::Image {
                asset_id: "raw".to_owned(),
                information_extracted: 0.5,
            },
            enabled: true,
            strength: 1.0,
        },
        VibeReferenceInput {
            id: "encoded-last".to_owned(),
            input: VibeInput::Encoded {
                asset_id: "encoding-last".to_owned(),
            },
            enabled: true,
            strength: -1.0,
        },
    ];
    let frozen = prepare_submission(vibe, &ReferenceAssets).unwrap();
    let reopened = sqlite::decode_submission(&sqlite::encode_submission(&frozen).unwrap()).unwrap();
    let effective = &reopened.resolved().unwrap().inputs.references.vibes;
    assert_eq!(
        effective
            .iter()
            .map(|row| row.input.asset_id())
            .collect::<Vec<_>>(),
        ["encoding-first", "encoding-last"]
    );
    assert_eq!(effective[1].strength.to_bits(), (-0.5_f32).to_bits());
    assert!(
        reopened
            .diagnostics()
            .iter()
            .any(|item| item.input_id.as_deref() == Some("wrong-raw"))
    );
}

#[test]
fn medium_selection_and_effective_high_request_survive_freeze_and_legacy_open() {
    let (mut queue, _) = memory_queue(Arc::new(MemoryJobs::default()), false);
    let queue_mut = Arc::get_mut(&mut queue).unwrap();
    queue_mut.assets = Arc::new(ReferenceAssets);
    queue_mut.tokenizers = Arc::new(Tokenizers::bundled().unwrap());
    let mut draft = Draft::default();
    draft.settings.model = Some(Model::NaiDiffusion5FullMedium);
    draft
        .inputs
        .references
        .precise
        .push(precise_input("ref", CharacterReferenceType::Style));
    let quote = queue.quote(&draft).unwrap();
    assert_eq!(
        quote.resolved.unwrap().settings.model,
        Model::NaiDiffusion5Full
    );
    let frozen = queue.freeze(&draft).unwrap();
    let encoded = sqlite::encode_submission(&frozen).unwrap();
    let reopened = sqlite::decode_submission(&encoded).unwrap();
    assert_eq!(reopened, frozen);
    assert_eq!(request(&reopened).core.model, Model::NaiDiffusion5Full);
    assert_eq!(request(&reopened).sampling.steps, 23);
    assert!(matches!(
        reopened,
        FrozenSubmission::Generation {
            selected_model: Some(Model::NaiDiffusion5FullMedium),
            ..
        }
    ));
    let mut legacy: serde_json::Value = serde_json::from_str(&encoded).unwrap();
    assert!(
        legacy
            .as_object_mut()
            .unwrap()
            .remove("selected_model")
            .is_some()
    );
    let reopened = sqlite::decode_submission(&legacy.to_string()).unwrap();
    assert!(matches!(
        reopened,
        FrozenSubmission::Generation {
            selected_model: None,
            ..
        }
    ));
    assert_eq!(request(&reopened).core.model, Model::NaiDiffusion5Full);
}
