use super::*;
use crate::{
    prompt::{CharacterComposition, Composition, GenerationSettings, PromptNode, ResourceContent},
    session::ReferenceInputs,
};

const SOURCE: &str = "0e2817b2-fcd7-4ff8-853e-677362d89466";
const OTHER: &str = "e9bdb1f8-8baf-455c-81bd-bb54a0b29024";
const COPY: &str = "9a524515-aa3e-48cf-a4e7-46008601ba0c";

fn node(id: &str, resource_id: &str) -> PromptNode {
    PromptNode::Chunk {
        id: id.into(),
        enabled: false,
        resource_id: resource_id.into(),
        override_text: Some("local edit".into()),
    }
}

#[test]
fn collection_copies_keep_disabled_overrides_and_retarget_only_copied_dependencies() {
    let composition = Composition {
        positive: vec![node("selected", SOURCE), node("external", OTHER)],
        negative: vec![],
    };
    let character = CharacterComposition {
        id: "character".into(),
        enabled: false,
        composition: Composition {
            positive: vec![node("character-node", SOURCE)],
            negative: vec![],
        },
        position: novelai_bridge::CharacterPosition::default(),
    };
    let mut content = ResourceContent::Preset {
        composition,
        defaults: GenerationSettings::default(),
        characters: vec![character],
        references: ReferenceInputs::default(),
    };
    remap_content(&mut content, &HashMap::from([(SOURCE.into(), COPY.into())]));
    let ResourceContent::Preset {
        composition,
        characters,
        ..
    } = content
    else {
        unreachable!()
    };
    assert_eq!(
        composition.positive,
        vec![node("selected", COPY), node("external", OTHER)]
    );
    assert_eq!(
        characters[0].composition.positive,
        vec![node("character-node", COPY)]
    );
    assert!(!characters[0].enabled);
}
