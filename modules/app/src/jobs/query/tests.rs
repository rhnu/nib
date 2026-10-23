use super::*;
use crate::jobs::{sqlite, tests::submission};

#[test]
fn summaries_exclude_frozen_prompts_but_keep_feedback_and_reuse_identity() {
    let frozen = submission();
    let summary = OperationSummary::from(&frozen);
    assert!(matches!(
        summary,
        OperationSummary::Generation {
            sample_count: 1,
            source_asset_id: None
        }
    ));
    let serialized = serde_json::to_value(&summary).unwrap();
    assert!(serialized.get("request").is_none());
    assert!(serialized.get("resolved").is_none());
    assert!(!serialized.to_string().contains("a cat"));
    let projected = sqlite::decode_operation_summary(r#"{"kind":"encodeVibe","input":{"assetId":"source","model":"nai-diffusion-4-full","informationExtracted":0.4,"maskAssetId":"mask","cropToMask":true,"focusSeed":123,"infoExtractSeed":456}}"#).unwrap();
    let OperationSummary::EncodeVibe { input } = projected else {
        panic!("encoder summary expected")
    };
    assert_eq!(input.model, novelai_bridge::Model::NaiDiffusion4Full);
    assert_eq!(input.asset_id, "source");
    assert_eq!(input.mask_asset_id.as_deref(), Some("mask"));
    assert_eq!(input.crop_to_mask, Some(true));
    assert_eq!(input.focus_seed, Some(123));
    assert_eq!(input.info_extract_seed, Some(456));
}
