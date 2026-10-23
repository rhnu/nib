use super::{super::tests::source_file, *};

#[test]
fn reencoding_uses_the_selected_cache_parameters_and_sdk_model_identity() {
    let file = source_file();
    let material = reencoding_material(&file, Some("v4full"), Some("unknown")).unwrap();
    assert_eq!(material.model, novelai_bridge::Model::NaiDiffusion4Full);
    assert_eq!(material.information_extracted, Some(0.4));
    assert_eq!(material.image.as_bytes(), material.mask.unwrap().as_bytes());
    assert!(matches!(
        reencoding_material(&file, Some("future-model"), Some("unknown")),
        Err(PersistenceError::InvalidData { .. })
    ));
    assert!(matches!(
        reencoding_material(&file, Some("v4full"), Some("missing")),
        Err(PersistenceError::InvalidData { .. })
    ));
    let mut no_image = file;
    no_image.image = None;
    assert!(matches!(
        reencoding_material(&no_image, Some("v4full"), Some("unknown")),
        Err(PersistenceError::InvalidData { .. })
    ));
}
