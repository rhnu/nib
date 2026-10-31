use super::*;

struct Identities;

impl AssetReader for Identities {
    fn image(&self, id: &str) -> Result<novelai_bridge::EncodedImage, PersistenceError> {
        Err(PersistenceError::NotFound {
            kind: "image bytes",
            id: id.to_owned(),
        })
    }

    fn image_identity(&self, id: &str) -> Result<BlobId, PersistenceError> {
        Ok(BlobId::for_bytes(match id {
            "source" | "alias" => b"same image",
            "other" => b"other image",
            "mask" => b"mask image",
            _ => {
                return Err(PersistenceError::NotFound {
                    kind: "image asset",
                    id: id.to_owned(),
                });
            },
        }))
    }

    fn vibe(&self, id: &str) -> Result<novelai_bridge::VibeEncoding, PersistenceError> {
        Err(PersistenceError::NotFound {
            kind: "Vibe bytes",
            id: id.to_owned(),
        })
    }
}

fn input() -> FrozenSubmission {
    FrozenSubmission::EncodeVibe {
        asset_id: "source".into(),
        policy: novelai_bridge::ValidationPolicy::Normalize,
        model: novelai_bridge::Model::NaiDiffusion45Full,
        information_extracted: 0.6,
        mask_asset_id: None,
        crop_to_mask: None,
        focus_seed: None,
        info_extract_seed: None,
        diagnostics: Vec::new(),
    }
}

fn key(input: &FrozenSubmission) -> DerivationKey {
    DerivationKey::for_submission(input, &Identities)
        .unwrap()
        .unwrap()
}

#[test]
fn content_aliases_share_keys_while_changed_content_and_masks_do_not() {
    let original = input();
    let original_key = key(&original);
    let mut changed = original.clone();
    let FrozenSubmission::EncodeVibe { asset_id, .. } = &mut changed else {
        unreachable!()
    };
    *asset_id = "alias".into();
    assert_eq!(key(&changed), original_key);
    let FrozenSubmission::EncodeVibe { asset_id, .. } = &mut changed else {
        unreachable!()
    };
    *asset_id = "other".into();
    assert_ne!(key(&changed), original_key);

    let mut masked = original;
    let FrozenSubmission::EncodeVibe { mask_asset_id, .. } = &mut masked else {
        unreachable!()
    };
    *mask_asset_id = Some("mask".into());
    assert_ne!(key(&masked), original_key);
    let masked_key = key(&masked);
    let FrozenSubmission::EncodeVibe { mask_asset_id, .. } = &mut masked else {
        unreachable!()
    };
    *mask_asset_id = Some("other".into());
    assert_ne!(key(&masked), masked_key);
}

#[test]
fn optional_controls_and_exact_float_bits_are_part_of_the_key() {
    let original_key = key(&input());
    for crop in [Some(false), Some(true)] {
        let mut changed = input();
        let FrozenSubmission::EncodeVibe { crop_to_mask, .. } = &mut changed else {
            unreachable!()
        };
        *crop_to_mask = crop;
        assert_ne!(key(&changed), original_key);
    }
    let mut focus = input();
    let FrozenSubmission::EncodeVibe { focus_seed, .. } = &mut focus else {
        unreachable!()
    };
    *focus_seed = Some(0);
    let mut extraction = input();
    let FrozenSubmission::EncodeVibe {
        info_extract_seed, ..
    } = &mut extraction
    else {
        unreachable!()
    };
    *info_extract_seed = Some(0);
    assert_ne!(key(&focus), original_key);
    assert_ne!(key(&extraction), original_key);
    assert_ne!(key(&focus), key(&extraction));

    let mut changed = input();
    let FrozenSubmission::EncodeVibe {
        information_extracted,
        ..
    } = &mut changed
    else {
        unreachable!()
    };
    *information_extracted = f32::from_bits(information_extracted.to_bits() + 1);
    assert_ne!(key(&changed), original_key);
}

#[test]
fn model_encoder_identity_determines_reuse_independently_of_policy() {
    let original = input();
    let original_key = key(&original);
    for model in novelai_bridge::Model::ALL {
        if !model.descriptor().can_encode_vibe() {
            continue;
        }
        let mut changed = original.clone();
        let FrozenSubmission::EncodeVibe {
            model: target,
            policy,
            ..
        } = &mut changed
        else {
            unreachable!()
        };
        *target = model;
        *policy = novelai_bridge::ValidationPolicy::Reject;
        assert_eq!(
            key(&changed) == original_key,
            model.vibe_model_key() == novelai_bridge::Model::NaiDiffusion45Full.vibe_model_key()
        );
    }
}

#[test]
fn missing_input_identity_remains_an_input_media_error() {
    let mut missing = input();
    let FrozenSubmission::EncodeVibe { asset_id, .. } = &mut missing else {
        unreachable!()
    };
    *asset_id = "missing".into();
    assert!(matches!(
        DerivationKey::for_submission(&missing, &Identities),
        Err(JobError::InputMedia {
            source: PersistenceError::NotFound { .. }
        })
    ));
}
