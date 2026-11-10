use super::*;

#[test]
fn default_uses_current_built_in_without_an_update_notice() {
    let prompt = AgentSystemPrompt::from_stored(None, "current instructions");
    assert_eq!(prompt.effective(), "current instructions");
    assert!(prompt.custom_prompt.is_none());
    assert!(!prompt.built_in_changed);
}

#[test]
fn custom_prompt_replaces_built_in_and_preserves_exact_text() {
    let custom = "  Custom instructions\n\n";
    validate_custom_prompt(Some(custom)).unwrap();
    let stored = StoredSystemPrompt::replacement(None, Some(custom.into()), "built in");
    let prompt = AgentSystemPrompt::from_stored(stored, "built in");
    assert_eq!(prompt.effective(), custom);
    assert_eq!(prompt.built_in, "built in");
    assert!(!prompt.built_in_changed);
}

#[test]
fn explicitly_saved_built_in_stays_custom_after_an_update() {
    let stored = StoredSystemPrompt::replacement(None, Some("old built in".into()), "old built in");
    let prompt = AgentSystemPrompt::from_stored(stored, "new built in");
    assert_eq!(prompt.custom_prompt.as_deref(), Some("old built in"));
    assert_eq!(prompt.effective(), "old built in");
    assert!(prompt.built_in_changed);
}

#[test]
fn built_in_update_preserves_custom_text_and_notice_until_changed_or_reset() {
    let stored = StoredSystemPrompt::replacement(None, Some("custom".into()), "old");
    let prompt = AgentSystemPrompt::from_stored(stored.clone(), "new");
    assert_eq!(prompt.effective(), "custom");
    assert!(prompt.built_in_changed);

    let unchanged = StoredSystemPrompt::replacement(stored.as_ref(), Some("custom".into()), "new");
    assert!(AgentSystemPrompt::from_stored(unchanged, "new").built_in_changed);

    let changed = StoredSystemPrompt::replacement(stored.as_ref(), Some("edited".into()), "new");
    let prompt = AgentSystemPrompt::from_stored(changed, "new");
    assert_eq!(prompt.effective(), "edited");
    assert!(!prompt.built_in_changed);

    validate_custom_prompt(None).unwrap();
    let reset = StoredSystemPrompt::replacement(stored.as_ref(), None, "new");
    let prompt = AgentSystemPrompt::from_stored(reset, "new");
    assert_eq!(prompt.effective(), "new");
    assert!(prompt.custom_prompt.is_none());
    assert!(!prompt.built_in_changed);
}

#[test]
fn whitespace_is_rejected_instead_of_becoming_a_reset() {
    for prompt in ["", "  ", "\n\r\t", "\u{2003}"] {
        assert!(matches!(
            validate_custom_prompt(Some(prompt)),
            Err(AgentError::Invalid(_))
        ));
    }
}
