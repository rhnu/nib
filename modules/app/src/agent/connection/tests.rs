use rig_core::{
    completion::{ReplayTarget, history::adapt},
    message::{DocumentSourceKind, Image, ImageMediaType, Message, UserContent},
};

use super::*;

#[test]
fn compatible_model_aliases_keep_images_in_the_model_input() {
    for (endpoint, model) in [
        ("https://example.test/v1", "my-vision-alias"),
        ("https://openrouter.ai/api/v1", "google/custom-vision-model"),
        ("https://api.deepseek.com", "custom-model"),
    ] {
        let config = provider(endpoint, "unused".into());
        let mut wire = config.chat(model);
        wire.facts = image_facts(&wire.facts, wire.provider.dialect.name, model);
        assert!(wire.accepts(model).user_images);
        let messages = vec![Message::User {
            content: vec![UserContent::Image(Image {
                data: DocumentSourceKind::Raw(vec![1, 2, 3]),
                media_type: Some(ImageMediaType::PNG),
                ..Image::default()
            })],
        }];
        let encoded = adapt(&messages, &wire);
        assert_eq!(encoded.iter().flat_map(Message::images).count(), 1);
        let mut responses =
            rig_core::providers::openai::responses_api::wire::Responses::new(config.clone(), model);
        responses.facts = image_facts(&responses.facts, responses.provider.dialect.name, model);
        let encoded = adapt(&messages, &responses);
        assert_eq!(encoded.iter().flat_map(Message::images).count(), 1);
    }
}
