use std::sync::Arc;

use novelai_bridge::{ClientConfig, Model, TagLanguage, TransportRequest, TransportResponse};

use super::*;

struct Suggestions;

#[async_trait]
impl Transport for Suggestions {
    async fn execute(
        &self,
        request: TransportRequest,
    ) -> Result<TransportResponse, novelai_bridge::TransportError> {
        let body = if request.endpoint.contains("lang=jp") {
            r#"[{"jp_tag":"猫","en_tag":"cat","power":42},{"jp_tag":"犬","en_tag":"dog","power":7}]"#
        } else {
            r#"{"tags":[{"tag":"cat","count":9,"confidence":0.8}]}"#
        };
        Ok(TransportResponse::from_bytes(
            200,
            vec![],
            body.as_bytes().to_vec(),
        ))
    }
}

#[tokio::test]
async fn shared_sdk_client_is_replaceable_without_erasing_language_specific_rankings() {
    let client = Client::new(Arc::new(Suggestions), ClientConfig::default());
    let query: &dyn TagQuery = &client;
    let mut request = SuggestTagsRequest::new("cat", Model::default());
    let SuggestTagsResult::English { tags } = query.suggest_tags(request.clone()).await.unwrap()
    else {
        panic!("English query must keep its frequency and confidence fields");
    };
    assert_eq!(tags[0].count, 9);
    assert_eq!(tags[0].confidence, 0.8);

    request.language = TagLanguage::Japanese;
    let SuggestTagsResult::Japanese(tags) = query.suggest_tags(request).await.unwrap() else {
        panic!("Japanese query must keep translations and provider ordering");
    };
    assert_eq!(tags[0].jp_tag, "猫");
    assert_eq!(tags[0].en_tag, "cat");
    assert_eq!(tags[0].power, 42);
    assert_eq!(tags[1].power, 7);
}
