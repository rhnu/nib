use super::*;

#[test]
fn source_comments_preserve_saved_text_and_cross_fragment_native_weight() {
    let draft = Draft {
        composition: Composition {
            positive: vec![
                text(FIRST_ID, "  2::猫 /* explanation */"),
                text(SECOND_ID, "犬:: // ignored"),
            ],
            negative: vec![text("negative", "blur /* annotation */")],
        },
        ..Draft::default()
    };
    let resolved = resolve_draft(&draft, &Resources::default()).unwrap();
    assert_eq!(resolved.positive, "2::猫\n犬::");
    assert_eq!(resolved.negative, "blur");
    assert_eq!(resolved.fragments[0].text, "  2::猫 /* explanation */");
    let analysis = resolved
        .prompt_analysis
        .iter()
        .find(|analysis| analysis.scope == PromptScope::Positive)
        .unwrap();
    let dog_source = analysis
        .sources
        .iter()
        .find(|source| source.fragment_index == 1)
        .unwrap();
    let dog = analysis
        .document
        .analysis
        .spans
        .iter()
        .find(|span| span.from == dog_source.from)
        .unwrap();
    assert_eq!(dog.weight, nib_prompt::PromptWeight::Exact { value: 2.0 });
}

#[test]
fn unfinished_comment_is_saved_as_editable_source_but_remains_a_resolution_error() {
    let draft = Draft {
        composition: Composition {
            positive: vec![
                text("unfinished", "cat /* unfinished"),
                text("other", "dog"),
            ],
            negative: vec![],
        },
        ..Draft::default()
    };
    validate_draft(&draft).unwrap();
    let resolved = resolve_draft(&draft, &Resources::default()).unwrap();
    assert_eq!(resolved.positive, "cat\ndog");
    assert!(!resolved.prompt_analysis[0].document.valid);
    assert_eq!(
        resolved.prompt_analysis[0].document.source_diagnostics[0].code,
        nib_prompt::SourceDiagnosticCode::UnclosedBlockComment
    );
}

#[test]
fn native_restore_preserves_literal_comment_markers_in_all_prompt_targets() {
    let mut request = novelai_bridge::GenerateImageRequest::builder(
        "cat // literal /* open",
        Model::NaiDiffusion45Full,
    )
    .negative_prompt("bad /* native */")
    .build();
    request.characters = Some(novelai_bridge::CharacterSet {
        characters: vec![novelai_bridge::Character {
            prompt: "hero // text".to_owned(),
            negative_prompt: Some("bad /* text".to_owned()),
            position: novelai_bridge::CharacterPosition::default(),
            enabled: true,
        }],
        use_coords: None,
    });
    let restored =
        crate::session::restore_generation(&request, crate::session::CreationInputs::default());
    let resolved = resolve_draft(&restored, &Resources::default()).unwrap();
    assert_eq!(resolved.generation_request(), request);
    assert!(
        resolved
            .prompt_analysis
            .iter()
            .all(|analysis| analysis.document.valid)
    );
    let metadata = novelai_bridge::ImageMetadata {
        prompt: Some("cat /* native".to_owned()),
        negative_prompt: Some("bad // literal".to_owned()),
        ..Default::default()
    };
    let restored = crate::session::draft_from_metadata(&metadata);
    let resolved = resolve_draft(&restored, &Resources::default()).unwrap();
    assert_eq!(resolved.positive, "cat /* native");
    assert_eq!(resolved.negative, "bad // literal");
}
