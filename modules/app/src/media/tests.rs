use super::*;

#[test]
fn restore_is_independent_and_does_not_repeat_sdk_prompt_additions() {
    let submitted = crate::jobs::tests::submission();
    let restored = restore_submission(&submitted);
    assert_eq!(restored.revision, 0);
    assert_eq!(restored.presets.len(), 0);
    assert!(
        restored
            .composition
            .positive
            .iter()
            .chain(&restored.composition.negative)
            .all(|node| matches!(node, PromptNode::Text { .. }))
    );
    assert_eq!(restored.settings.model, Some(submitted.request.core.model));
    assert_eq!(
        restored.settings.steps,
        Some(submitted.request.sampling.steps)
    );
    let PromptNode::Text { text, .. } = &restored.composition.positive[0] else {
        panic!("restored prompt is independent text")
    };
    assert_eq!(text, "a cat");
    // Reapply the SDK's recorded defaults to the original text, rather than
    // treating its already assembled prompt as another editable input.
    let repeated =
        novelai_bridge::GenerateImageRequest::builder(text, submitted.request.core.model)
            .negative_prompt(submitted.request.core.negative_prompt.clone().unwrap())
            .quality(submitted.request.core.quality)
            .uc_preset(submitted.request.core.uc_preset)
            .build()
            .normalize()
            .unwrap();
    assert_eq!(
        repeated.resolved_prompts().prompt,
        submitted.resolved.positive
    );
    assert_eq!(
        repeated.resolved_prompts().negative_prompt,
        submitted.resolved.negative
    );
}
