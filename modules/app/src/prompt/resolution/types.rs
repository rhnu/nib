//! Resolved composition values and SDK request projection.

use novelai_bridge::{Character, CharacterPosition, CharacterSet, GenerateImageRequest};
use serde::{Deserialize, Serialize};

use crate::{persistence::PersistenceError, prompt::ResolvedSettings, session::CreationInputs};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum PromptScope {
    Positive,
    Negative,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum ResolutionIssueKind {
    MissingResource,
    TypeMismatch,
    StaleOverride,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ResolutionIssue {
    pub kind: ResolutionIssueKind,
    pub scope: Option<PromptScope>,
    pub node_id: Option<String>,
    pub preset_instance_id: Option<String>,
    pub resource_id: Option<String>,
    pub message: String,
    pub character_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ResolvedFragment {
    pub text: String,
    pub scope: PromptScope,
    pub node_id: String,
    pub preset_instance_id: Option<String>,
    pub resource_id: Option<String>,
    pub resource_name: Option<String>,
    pub overridden: bool,
    pub expanded: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum SettingSource {
    #[default]
    SdkDefault,
    Preset {
        preset_instance_id: String,
        resource_id: Option<String>,
        name: String,
        expanded: bool,
    },
    PresetOverride {
        instance_id: String,
        resource_id: String,
    },
    Draft,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct SettingsProvenance {
    pub model: SettingSource,
    pub size: SettingSource,
    pub steps: SettingSource,
    pub scale: SettingSource,
    pub sampler: SettingSource,
    pub seed: SettingSource,
    pub n_samples: SettingSource,
    pub quality: SettingSource,
    pub uc_preset: SettingSource,
    pub legacy_uc: SettingSource,
    pub transparent_background: SettingSource,
    pub furry_mode: SettingSource,
    pub noise_schedule: SettingSource,
    pub cfg_rescale: SettingSource,
    pub variety_boost: SettingSource,
    pub decrisp: SettingSource,
    pub smea: SettingSource,
    pub smea_dyn: SettingSource,
    pub image_format: SettingSource,
    pub alpha_mode: SettingSource,
    pub response_format: SettingSource,
    pub use_coords: SettingSource,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ResolvedDraft {
    pub positive: String,
    pub negative: String,
    pub fragments: Vec<ResolvedFragment>,
    pub settings: ResolvedSettings,
    pub provenance: SettingsProvenance,
    pub issues: Vec<ResolutionIssue>,
    pub characters: Vec<ResolvedCharacter>,
    pub inputs: CreationInputs,
    pub input_sources: Vec<InputProvenance>,
}

/// Character composition resolved independently from the base prompt targets.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ResolvedCharacter {
    pub id: String,
    pub enabled: bool,
    pub positive: String,
    pub negative: String,
    #[cfg_attr(feature = "typegen", ts(type = "{ x: number; y: number }"))]
    pub position: CharacterPosition,
    pub fragments: Vec<ResolvedFragment>,
    pub preset_instance_id: Option<String>,
    pub resource_id: Option<String>,
    pub expanded: bool,
    pub overridden: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct InputProvenance {
    pub overridden: bool,
    pub id: String,
    pub preset_instance_id: Option<String>,
    pub resource_id: Option<String>,
    pub expanded: bool,
}

impl ResolvedDraft {
    /// Builds the SDK parameter and character portion; media inputs are hydrated by submission.
    #[must_use]
    pub fn generation_request(&self) -> GenerateImageRequest {
        let mut request = GenerateImageRequest::builder(&self.positive, self.settings.model)
            .negative_prompt(&self.negative)
            .build();
        self.settings.apply_to(&mut request);
        request.policy = self.inputs.policy;
        if !self.characters.is_empty() || self.settings.use_coords.is_some() {
            request.characters = Some(CharacterSet {
                characters: self
                    .characters
                    .iter()
                    .map(|character| Character {
                        prompt: character.positive.clone(),
                        negative_prompt: Some(character.negative.clone()),
                        position: character.position,
                        enabled: character.enabled,
                    })
                    .collect(),
                use_coords: self.settings.use_coords,
            });
        }
        request
    }
}

/// Storage failures preserve their original cause; editable dependency failures retain locations.
#[derive(Debug, thiserror::Error)]
pub enum ExpansionError {
    #[error(transparent)]
    Persistence(#[from] PersistenceError),
    #[error("cannot expand resource: unresolved dependencies")]
    Unresolved { issues: Vec<ResolutionIssue> },
}
