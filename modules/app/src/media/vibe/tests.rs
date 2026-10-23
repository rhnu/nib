use super::*;

#[test]
fn inspection_preserves_entry_and_cache_order_without_payloads() {
    let mut file = VibeFile::encoded("v4full", "AQID");
    file.name = Some("sample".to_owned());
    let record = |encoding: &str, extraction, mask| novelai_bridge::VibeEncodingRecord {
        encoding: encoding.to_owned(),
        params: Some(novelai_bridge::VibeEncodingParams {
            information_extracted: extraction,
            mask,
        }),
    };
    file.encodings = [
        (
            "v4full".to_owned(),
            [
                ("second".to_owned(), record("AQID", Some(0.7), None)),
                (
                    "first".to_owned(),
                    record("BAUG", None, Some("masked".to_owned())),
                ),
            ]
            .into_iter()
            .collect(),
        ),
        (
            "future-model".to_owned(),
            [("retained".to_owned(), record("BwgJ", None, None))]
                .into_iter()
                .collect(),
        ),
    ]
    .into_iter()
    .collect();
    let document = VibeDocument::Bundle(VibeBundle::new(vec![file]));
    let view = document_inspection("document", &document);
    assert!(view.is_bundle);
    assert_eq!(view.entries.len(), 1);
    let entry = &view.entries[0];
    assert_eq!(entry.name.as_deref(), Some("sample"));
    assert!(!entry.has_image);
    assert_eq!(
        entry
            .caches
            .iter()
            .map(|cache| cache.parameter_key.as_str())
            .collect::<Vec<_>>(),
        vec!["second", "first", "retained"]
    );
    assert_eq!(entry.caches[0].information_extracted, Some(0.7));
    assert!(entry.caches[1].has_mask);
    assert_eq!(entry.caches[2].model_key, "future-model");
}

pub(super) fn source_file() -> VibeFile {
    let source = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAC0lEQVR4nGNgQAcAABIAAXfx+gAAAAAASUVORK5CYII=";
    let mut file = VibeFile::image(source);
    file.name = Some("original-name".to_owned());
    let mut cache = VibeFile::encoded("v4full", "AQID").encodings;
    let record = cache.get_mut("v4full").unwrap().get_mut("unknown").unwrap();
    record.params = Some(novelai_bridge::VibeEncodingParams {
        information_extracted: Some(0.4),
        mask: Some(source.to_owned()),
    });
    file.encodings = cache;
    file
}

#[test]
fn image_entry_export_retains_original_identity_name_and_all_caches() {
    let file = source_file();
    let document = VibeDocument::Bundle(VibeBundle::new(vec![
        VibeFile::encoded("future", "BAUG"),
        file.clone(),
    ]));
    let selected = document_file(&document, "source-document", 1).unwrap();
    assert_eq!(selected, file);
    assert_eq!(selected.name.as_deref(), Some("original-name"));
    assert_eq!(selected.encodings["v4full"].len(), 1);
    let exported = VibeDocument::Single(Box::new(selected));
    let imported = VibeDocument::from_json(&exported.to_json().unwrap()).unwrap();
    assert_eq!(imported.files()[0], file);
    assert!(matches!(
        document_file(&document, "source-document", 9),
        Err(PersistenceError::InvalidData { .. })
    ));
}

#[test]
fn document_source_is_reported_without_inventing_a_materialized_asset() {
    let mut view = VibeAssetInspection {
        asset_id: "encoding".to_owned(),
        model_key: Some("v4full".to_owned()),
        parameter_key: Some("unknown".to_owned()),
        source_image_asset_id: None,
        has_source_image: false,
        source_document: None,
        can_reencode: false,
        information_extracted: None,
        encoding_input: None,
        can_export_document: false,
    };
    inspect_document_source(&mut view, &source_file(), "document", 2);
    assert!(view.has_source_image);
    assert!(view.can_reencode);
    assert!(view.source_image_asset_id.is_none());
    assert!(view.encoding_input.is_none());
    let source = view.source_document.unwrap();
    assert_eq!(source.asset_id, "document");
    assert_eq!(source.entry_index, 2);
    assert_eq!(view.information_extracted, Some(0.4));
}

#[test]
fn embedded_document_entries_do_not_count_other_png_encoding_carriers() {
    use novelai_bridge::{VibeMetadataEntry, VibeMetadataSource};
    let entry = |source| VibeMetadataEntry {
        source,
        display_name: None,
        encoding: None,
        model_encodings: std::collections::BTreeMap::default(),
        strength: None,
        information_extracted: None,
        has_image: false,
    };
    let entries = vec![
        entry(VibeMetadataSource::NovelAiVibeEncodingChunk),
        entry(VibeMetadataSource::NaiDataChunk),
        entry(VibeMetadataSource::NaiDataChunk),
        entry(VibeMetadataSource::CommentPayload),
    ];
    assert_eq!(embedded_document_index(&entries, 0), None);
    assert_eq!(embedded_document_index(&entries, 1), Some(0));
    assert_eq!(embedded_document_index(&entries, 2), Some(1));
    assert_eq!(embedded_document_index(&entries, 3), None);
    assert_eq!(embedded_document_index(&entries, 8), None);
}
