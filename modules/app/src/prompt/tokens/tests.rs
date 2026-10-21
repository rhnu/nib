use super::*;

#[test]
fn literal_token_inspection_reports_ids_framing_and_the_selected_model_limit() {
    let tokenizers = Tokenizers::bundled().unwrap();
    let model = Model::NaiDiffusion3;
    let content = inspect_tokens(&tokenizers, model, "cat", FramingPolicy::ContentOnly).unwrap();
    let framed = inspect_tokens(&tokenizers, model, "cat", FramingPolicy::ModelInput).unwrap();

    assert_eq!(content.model, model);
    assert_eq!(content.tokenizer, ImageTokenizerKind::Clip);
    assert_eq!(content.framing, FramingPolicy::ContentOnly);
    assert_ne!(content.token_ids, [] as [u32; 0]);
    assert_eq!(content.count.used as usize, content.token_ids.len());
    assert_eq!(content.count.limit, model.descriptor().prompt().token_limit);
    assert_eq!(framed.framing, FramingPolicy::ModelInput);
    assert_eq!(framed.count.used as usize, framed.token_ids.len());
    assert!(framed.count.used > content.count.used);
    assert!(
        framed
            .token_ids
            .windows(content.token_ids.len())
            .any(|tokens| tokens == content.token_ids.as_slice())
    );

    let value = serde_json::to_value(&framed).unwrap();
    assert_eq!(value["model"], model.as_str());
    assert_eq!(value["tokenizer"], "clip");
    assert_eq!(value["framing"], "model_input");
    assert_eq!(value["count"]["used"], framed.count.used);
    assert_eq!(
        value["tokenIds"].as_array().unwrap().len(),
        framed.token_ids.len()
    );
}

#[test]
fn missing_encoder_retains_the_sdk_error_and_requested_tokenizer() {
    let error = inspect_tokens(
        &Tokenizers::new(),
        Model::NaiDiffusion5FullMedium,
        "cat",
        FramingPolicy::ContentOnly,
    )
    .unwrap_err();
    assert!(matches!(
        error,
        TokenizerError::TokenizerNotLoaded {
            kind: ImageTokenizerKind::Qwen
        }
    ));
}
