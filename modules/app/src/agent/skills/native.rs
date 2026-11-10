use std::{
    io::Read as _,
    path::{Component, Path, PathBuf},
    sync::Arc,
};

use rig_core::{
    message::ToolName,
    tool::{DynamicTool, ToolExecutionError, ToolOutput},
};
use serde::Deserialize;
use serde_json::json;

use super::{SkillConfig, SkillDocument, SkillSummary};
use crate::agent::configuration::{
    AgentConfiguration, ExtensionAdmit, ExtensionError, ExtensionRecorder,
};

const MAX_DOCUMENT_BYTES: u64 = 512 * 1024;

#[derive(Deserialize)]
struct Frontmatter {
    name: String,
    description: String,
}

impl AgentConfiguration {
    /// Lists registered directories, including disabled skills.
    /// # Errors
    /// Returns configuration storage failures.
    pub fn skills(&self) -> Result<Vec<SkillConfig>, ExtensionError> {
        Ok(self.settings.agent_skills()?)
    }

    /// Registers one directory containing SKILL.md, or updates its enabled state.
    /// # Errors
    /// Returns invalid directories/frontmatter or settings failures.
    pub fn save_skill(&self, mut config: SkillConfig) -> Result<Vec<SkillConfig>, ExtensionError> {
        let _guard = self
            .connection_change
            .lock()
            .map_err(|_error| ExtensionError::Locked)?;
        if config.id.is_empty() {
            config.id = uuid::Uuid::new_v4().to_string();
        }
        if uuid::Uuid::parse_str(&config.id).is_err() {
            return Err(ExtensionError::Invalid("Invalid skill identity."));
        }
        let mut skills = self.settings.agent_skills()?;
        let previous = skills.iter().find(|s| s.id == config.id);
        // Disabling a missing or broken registration must remain possible.
        if config.enabled || previous.is_none_or(|s| s.directory != config.directory) {
            let root = root(&config)?;
            root.to_str()
                .ok_or(ExtensionError::Invalid(
                    "The skill directory must be UTF-8.",
                ))?
                .clone_into(&mut config.directory);
            summary(&config)?;
            if skills
                .iter()
                .any(|s| s.id != config.id && Path::new(&s.directory) == root)
            {
                return Err(ExtensionError::Invalid(
                    "This skill directory is already registered.",
                ));
            }
        }
        if let Some(index) = skills.iter().position(|s| s.id == config.id) {
            skills[index] = config;
        } else {
            skills.push(config);
        }
        self.settings.save_agent_skills(&skills)?;
        self.skills()
    }

    /// Removes the registration without changing files in the user's directory.
    /// # Errors
    /// Returns missing identity or configuration failures.
    pub fn remove_skill(&self, id: &str) -> Result<Vec<SkillConfig>, ExtensionError> {
        let _guard = self
            .connection_change
            .lock()
            .map_err(|_error| ExtensionError::Locked)?;
        let mut skills = self.settings.agent_skills()?;
        let index = skills
            .iter()
            .position(|s| s.id == id)
            .ok_or(ExtensionError::Invalid("Skill not found."))?;
        skills.remove(index);
        self.settings.save_agent_skills(&skills)?;
        self.skills()
    }

    /// Loads only name and description of enabled skills; the body is not supplied to the model.
    /// # Errors
    /// Returns invalid enabled skill metadata or file/configuration failures.
    pub fn skill_catalog(&self) -> Result<Vec<SkillSummary>, ExtensionError> {
        self.skills()?
            .iter()
            .filter(|s| s.enabled)
            .map(summary)
            .collect()
    }

    /// Reads SKILL.md or a relative file inside one registered directory.
    /// # Errors
    /// Rejects traversal, symlinks leaving the directory, nonfiles and oversized/non-UTF8 content.
    pub fn read_skill(
        &self,
        id: &str,
        path: Option<&str>,
    ) -> Result<SkillDocument, ExtensionError> {
        let config = self
            .skills()?
            .into_iter()
            .find(|s| s.id == id)
            .ok_or(ExtensionError::Invalid("Skill not found."))?;
        document(&config, path.unwrap_or("SKILL.md"))
    }
}

fn root(config: &SkillConfig) -> Result<PathBuf, ExtensionError> {
    let directory = Path::new(&config.directory);
    if !directory.is_absolute() {
        return Err(ExtensionError::Invalid(
            "Select an absolute skill directory containing SKILL.md.",
        ));
    }
    let root = directory
        .canonicalize()
        .map_err(|e| ExtensionError::failure("Read the skill directory.", e))?;
    if !root.is_dir() {
        return Err(ExtensionError::Invalid(
            "The skill path must be a directory.",
        ));
    }
    Ok(root)
}

fn document(config: &SkillConfig, relative: &str) -> Result<SkillDocument, ExtensionError> {
    let root = root(config)?;
    let relative_path = Path::new(relative);
    if relative.is_empty()
        || relative_path
            .components()
            .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
    {
        return Err(ExtensionError::Invalid(
            "Skill references must be relative files within the registered directory.",
        ));
    }
    let path = root
        .join(relative_path)
        .canonicalize()
        .map_err(|e| ExtensionError::failure("Locate the referenced skill file.", e))?;
    if !path.starts_with(&root) {
        return Err(ExtensionError::Invalid(
            "Skill reference leaves its registered directory.",
        ));
    }
    let mut file = std::fs::File::open(&path)
        .map_err(|e| ExtensionError::failure("Open the referenced skill file.", e))?;
    let metadata = file
        .metadata()
        .map_err(|e| ExtensionError::failure("Inspect the referenced skill file.", e))?;
    if !metadata.is_file() || metadata.len() > MAX_DOCUMENT_BYTES {
        return Err(ExtensionError::Invalid(
            "Skill files must be text files no larger than 512 KiB.",
        ));
    }
    let mut content = String::new();
    (&mut file)
        .take(MAX_DOCUMENT_BYTES + 1)
        .read_to_string(&mut content)
        .map_err(|e| ExtensionError::failure("Read the skill text as UTF-8.", e))?;
    if content.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err(ExtensionError::Invalid("Skill file exceeds 512 KiB."));
    }
    Ok(SkillDocument {
        path: relative.to_owned(),
        content,
    })
}

fn frontmatter(text: &str) -> Result<Frontmatter, ExtensionError> {
    let mut lines = text.strip_prefix('\u{feff}').unwrap_or(text).lines();
    if lines.next() != Some("---") {
        return Err(ExtensionError::Invalid(
            "SKILL.md must begin with YAML frontmatter containing name and description.",
        ));
    }
    let mut yaml = String::new();
    let mut closed = false;
    for line in lines {
        if line == "---" || line == "..." {
            closed = true;
            break;
        }
        yaml.push_str(line);
        yaml.push('\n');
    }
    if !closed {
        return Err(ExtensionError::Invalid(
            "SKILL.md YAML frontmatter is not closed.",
        ));
    }
    let fields: Frontmatter = serde_yaml_ng::from_str(&yaml)
        .map_err(|e| ExtensionError::failure("Parse the skill YAML frontmatter.", e))?;
    if fields.name.trim().is_empty()
        || fields.description.trim().is_empty()
        || fields.name.len() > 256
        || fields.description.len() > 16 * 1024
    {
        return Err(ExtensionError::Invalid(
            "Skill name and description must be nonempty (maximum 256 bytes and 16 KiB respectively).",
        ));
    }
    Ok(fields)
}

fn summary(config: &SkillConfig) -> Result<SkillSummary, ExtensionError> {
    let document = document(config, "SKILL.md")?;
    let fields = frontmatter(&document.content)?;
    Ok(SkillSummary {
        id: config.id.clone(),
        name: fields.name,
        description: fields.description,
    })
}

pub(crate) fn runtime_tools(
    configuration: &Arc<AgentConfiguration>,
    recorder: &ExtensionRecorder,
    admit: &ExtensionAdmit,
) -> Vec<DynamicTool> {
    [false, true].into_iter().map(|read| {
        let configuration = Arc::clone(configuration);
        let recorder = Arc::clone(recorder);
        let admit = Arc::clone(admit);
        let name = if read { "read_skill" } else { "list_skills" };
        let description = if read {
            "Read an enabled skill's SKILL.md or a referenced text file relative to its directory. Skills supply guidance and text references only; no script execution is provided."
        } else {
            "List enabled skills by identity, name and description. Read a relevant skill before following it."
        };
        let parameters = if read {
            json!({"type":"object","properties":{"id":{"type":"string"},"path":{"type":["string","null"]}},"required":["id"],"additionalProperties":false})
        } else {
            json!({"type":"object","properties":{},"additionalProperties":false})
        };
        DynamicTool::new(
            ToolName::new(name).expect("static tool name"),
            description,
            parameters,
            move |args| {
                let configuration = Arc::clone(&configuration);
                let recorder = Arc::clone(&recorder);
                let admit = Arc::clone(&admit);
                Box::pin(async move {
                    let activity = admit().map_err(|e| ToolExecutionError::other(e.safe_message()).with_source(e))?;
                    let (result, activity) = tokio::task::spawn_blocking(move || {
                        let result = skill_output(&configuration, read, &args);
                        (result, activity)
                    }).await.map_err(|error| ToolExecutionError::other("Read skill task failed.").with_source(error))?;
                    match result {
                        Ok(value) => crate::agent::configuration::record_extension(recorder, activity, name.to_owned(), true, ToolOutput::json(value)).await,
                        Err(error) => {
                            let output = crate::agent::configuration::record_extension(recorder, activity, name.to_owned(), false, ToolOutput::text(error.safe_message())).await?;
                            Err(ToolExecutionError::other(error.safe_message()).with_model_output(output).with_source(error))
                        }
                    }
                })
            },
        )
    }).collect()
}

fn skill_output(
    configuration: &AgentConfiguration,
    read: bool,
    args: &serde_json::Value,
) -> Result<serde_json::Value, ExtensionError> {
    if !read {
        return serde_json::to_value(configuration.skill_catalog()?)
            .map_err(|e| ExtensionError::failure("Encode skill catalog.", e));
    }
    let id = args
        .get("id")
        .and_then(serde_json::Value::as_str)
        .ok_or(ExtensionError::Invalid("A skill identity is required."))?;
    if !configuration
        .skills()?
        .iter()
        .any(|s| s.id == id && s.enabled)
    {
        return Err(ExtensionError::Invalid("Skill is not enabled."));
    }
    let path = args.get("path").and_then(serde_json::Value::as_str);
    serde_json::to_value(configuration.read_skill(id, path)?)
        .map_err(|e| ExtensionError::failure("Encode skill text.", e))
}

#[cfg(test)]
mod tests;
