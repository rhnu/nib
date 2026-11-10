//! Resolve retained asset references only for the duration of a model request.

use std::{
    io::Cursor,
    sync::{Arc, atomic::Ordering},
};

use rig_core::{
    message::{
        DocumentSourceKind, Image, ImageMediaType, Message, ToolName, ToolResultContent,
        UserContent,
    },
    tool::{DynamicTool, ToolExecutionError, ToolOutput},
};
use serde::Deserialize;
use serde_json::json;

use super::{AgentError, AgentMessage, runtime::AgentRuntime};
use crate::{
    media::{AssetKind, AssetSource, BlobId, MediaLibrary},
    persistence::PersistenceError,
    state::AppState,
};

const ASSET_PREFIX: &str = "nib-asset:";
pub(super) const MAX_ATTACHMENTS: usize = 4;

/// Imports extension images before returning them to Rig; call from a blocking worker
/// holding creation-data write access and the tool's activity guard.
pub(super) fn record_extension_output(
    runtime: &AgentRuntime,
    app: &AppState,
    name: &str,
    success: bool,
    output: ToolOutput,
) -> Result<ToolOutput, AgentError> {
    let normalized = map_extension_images(output, |image| {
        let media = app.media()?;
        let id = match extension_image_source(image.data)? {
            ExtensionImageSource::Bytes(bytes) => {
                media
                    .import_image(
                        bytes,
                        AssetSource::Import {
                            name: Some(name.to_owned()),
                        },
                    )?
                    .id
            },
            ExtensionImageSource::Asset(id) => id,
        };
        Ok((runtime.model_image(&media, &id)?, id))
    });
    let (output, asset_ids) = match normalized {
        Ok(value) => value,
        Err(error) => {
            if extension_storage_failure(&error) {
                runtime.storage_failed.store(true, Ordering::Release);
            }
            let diagnostic = if image_validation_failure(&error) {
                "The extension returned invalid image data."
            } else {
                error.safe_message()
            };
            if let Err(recording) = save_extension_record(runtime, name, false, diagnostic, vec![])
            {
                runtime.storage_failed.store(true, Ordering::Release);
                return Err(PersistenceError::failure(
                    "record a rejected extension result",
                    ExtensionRecordFailure {
                        primary: error,
                        recording,
                    },
                )
                .into());
            }
            return Err(error);
        },
    };
    let content = if success {
        "completed successfully".into()
    } else {
        extension_failure_text(&output)
    };
    if let Err(error) = save_extension_record(runtime, name, success, &content, asset_ids) {
        runtime.storage_failed.store(true, Ordering::Release);
        return Err(error);
    }
    tracing::debug!(tool = name, success, "assistant extension tool finished");
    Ok(output)
}

/// Keeps both failures structured when even a rejection record cannot be saved.
#[derive(Debug, thiserror::Error)]
#[error("extension output failed ({primary}); recording the failure also failed ({recording})")]
struct ExtensionRecordFailure {
    #[source]
    primary: AgentError,
    recording: AgentError,
}

fn save_extension_record(
    runtime: &AgentRuntime,
    name: &str,
    success: bool,
    content: &str,
    asset_ids: Vec<String>,
) -> Result<(), AgentError> {
    let mut chat = runtime.chat.lock().map_err(|_error| AgentError::Locked)?;
    let mut next = chat.clone();
    // Never duplicate rich output or potentially large skill instructions in display records.
    next.snapshot.messages.push(AgentMessage {
        id: uuid::Uuid::new_v4().to_string(),
        role: "tool".into(),
        content: format!("{name}: {content}"),
        tool_name: Some(name.to_owned()),
        success: Some(success),
        asset_ids,
    });
    runtime.database.save_agent_chat(&next)?;
    *chat = next;
    Ok(())
}

fn extension_failure_text(output: &ToolOutput) -> String {
    output
        .as_content()
        .iter()
        .find_map(|part| match part {
            ToolResultContent::Text(text) => Some(text.text.as_str()),
            ToolResultContent::Json { value } => {
                value.get("error").and_then(serde_json::Value::as_str)
            },
            ToolResultContent::Image(_) => None,
        })
        .filter(|text| !text.trim().is_empty())
        .unwrap_or("The extension tool failed.")
        .chars()
        .take(1024)
        .collect()
}

fn image_validation_failure(error: &AgentError) -> bool {
    // In this local image path BridgeError is SDK image/base64 validation,
    // not a database or filesystem operation.
    matches!(error, AgentError::Persistence(PersistenceError::Failure { source, .. })
        if source.is::<novelai_bridge::BridgeError>())
}

fn extension_storage_failure(error: &AgentError) -> bool {
    match error {
        AgentError::Locked | AgentError::Persistence(PersistenceError::Locked) => true,
        AgentError::Persistence(PersistenceError::Failure { source, .. }) => {
            !image_validation_failure(error) && !source.is::<ToolExecutionError>()
        },
        _ => false,
    }
}

enum ExtensionImageSource {
    Bytes(Vec<u8>),
    Asset(String),
}

fn extension_image_source(source: DocumentSourceKind) -> Result<ExtensionImageSource, AgentError> {
    match source {
        DocumentSourceKind::Raw(bytes) => Ok(ExtensionImageSource::Bytes(bytes)),
        DocumentSourceKind::Base64(value) => {
            let image = novelai_bridge::EncodedImage::from_base64(&value)
                .map_err(|error| PersistenceError::failure("decode extension image", error))?;
            Ok(ExtensionImageSource::Bytes(image.as_bytes().to_vec()))
        },
        DocumentSourceKind::Url(url) => url
            .strip_prefix(ASSET_PREFIX)
            .filter(|id| !id.is_empty())
            .map(|id| ExtensionImageSource::Asset(id.to_owned()))
            .ok_or(AgentError::Invalid(
                "The extension returned an image URL that cannot be retained locally.",
            )),
        DocumentSourceKind::FileId(_) | DocumentSourceKind::Unknown => Err(AgentError::Invalid(
            "The extension returned an image source that cannot be retained locally.",
        )),
    }
}

fn map_extension_images(
    output: ToolOutput,
    mut retain: impl FnMut(Image) -> Result<(Image, String), AgentError>,
) -> Result<(ToolOutput, Vec<String>), AgentError> {
    let mut asset_ids = Vec::new();
    let mut content = output.into_content();
    for part in &mut content {
        // Rig preserves unsupported MCP binary blocks as JSON. These have no
        // application asset representation and must not enter retained history.
        if let ToolResultContent::Json { value } = part {
            let kind = value.get("type").and_then(serde_json::Value::as_str);
            if matches!(kind, Some("audio" | "image"))
                || (kind == Some("resource")
                    && value
                        .get("resource")
                        .and_then(|resource| resource.get("blob"))
                        .is_some())
            {
                return Err(AgentError::Invalid(
                    "The extension returned a media type that cannot be retained locally.",
                ));
            }
        }
        if let ToolResultContent::Image(image) = part {
            let (prepared, id) = retain(std::mem::take(image))?;
            *image = prepared;
            if !asset_ids.contains(&id) {
                asset_ids.push(id);
            }
        }
    }
    let output = ToolOutput::content(content)
        .map_err(|error| PersistenceError::failure("prepare extension tool output", error))?;
    Ok((output, asset_ids))
}

pub(super) fn tools(runtime: &Arc<AgentRuntime>, app: &AppState) -> Vec<DynamicTool> {
    let specs = [
        (
            "read_image",
            "Read an image asset by its assetId (from creation inputs, attachments or saved results) and return actual image content for visual analysis.",
            json!({"assetId":{"type":"string"}}),
            vec!["assetId"],
        ),
        (
            "list_image_results",
            "List saved image results, newest first, optionally for one job. Returns assetId for read_image and a pagination cursor. This does not generate images.",
            json!({"jobId":{"type":["string","null"]},"before":{"type":["string","null"]}}),
            vec![],
        ),
    ];
    specs
        .into_iter()
        .map(|(name, description, properties, required)| {
            let runtime = Arc::clone(runtime);
            let app = app.clone();
            DynamicTool::new(
                ToolName::new(name).expect("static name"),
                description,
                json!({
                    "type": "object",
                    "properties": properties,
                    "required": required,
                    "additionalProperties": false
                }),
                move |args| {
                    let runtime = Arc::clone(&runtime);
                    let app = app.clone();
                    Box::pin(async move {
                        let activity = runtime.tool_activity();
                        let worker = Arc::clone(&runtime);
                        let access = app.write_access().await.map_err(|_error| {
                            ToolExecutionError::other("Creation data is not writable.")
                        })?;
                        tokio::task::spawn_blocking(move || {
                            let _activity = activity;
                            let _access = access;
                            let mut asset_ids = vec![];
                            let result = (|| {
                                if worker.cancelled.load(Ordering::Acquire) {
                                    return Err(AgentError::Cancelled);
                                }
                                let media = app.media()?;
                                if name == "read_image" {
                                    #[derive(Deserialize)]
                                    #[serde(rename_all = "camelCase", deny_unknown_fields)]
                                    struct Args {
                                        asset_id: String,
                                    }
                                    let args: Args =
                                        serde_json::from_value(args).map_err(|_error| {
                                            AgentError::Invalid("Provide an image assetId.")
                                        })?;
                                    let image = worker.model_image(&media, &args.asset_id)?;
                                    asset_ids.push(args.asset_id.clone());
                                    ToolOutput::content(vec![
                                        ToolResultContent::json(json!({"assetId":args.asset_id})),
                                        ToolResultContent::Image(image),
                                    ])
                                    .map_err(|_error| AgentError::Locked)
                                } else {
                                    #[derive(Deserialize)]
                                    #[serde(rename_all = "camelCase", deny_unknown_fields)]
                                    struct Args {
                                        job_id: Option<String>,
                                        before: Option<String>,
                                    }
                                    let args: Args =
                                        serde_json::from_value(args).map_err(|_error| {
                                            AgentError::Invalid(
                                                "Provide optional jobId and before fields.",
                                            )
                                        })?;
                                    let page = media.list(&crate::media::ResultQuery {
                                        kind: Some(AssetKind::Image),
                                        job_id: args.job_id,
                                        before: args.before,
                                        limit: 20,
                                    })?;
                                    Ok(ToolOutput::json(
                                        serde_json::to_value(page)
                                            .map_err(|_error| AgentError::Locked)?,
                                    ))
                                }
                            })();
                            super::tools::record_output(&worker, name, result, asset_ids)
                        })
                        .await
                        .map_err(|_error| ToolExecutionError::other("The image worker failed."))?
                    })
                },
            )
        })
        .collect()
}

pub(super) fn user_message(record: &AgentMessage) -> Message {
    let mut content = vec![UserContent::text(record.content.clone())];
    content.extend(record.asset_ids.iter().map(|id| {
        UserContent::Image(Image {
            data: DocumentSourceKind::Url(format!("{ASSET_PREFIX}{id}")),
            ..Image::default()
        })
    }));
    Message::User { content }
}

impl AgentRuntime {
    /// Bounds visual context while retaining the original asset unchanged.
    pub(super) fn model_image(&self, media: &MediaLibrary, id: &str) -> Result<Image, AgentError> {
        let sources = self
            .image_sources
            .lock()
            .map_err(|_error| AgentError::Locked)?;
        if sources.len() >= 24 && !sources.values().any(|source| source == id) {
            return Err(AgentError::Invalid(
                "The conversation reached its image limit. Start a new conversation before adding more images.",
            ));
        }
        drop(sources);
        let asset = media.asset(id)?;
        if asset.kind != AssetKind::Image {
            return Err(AgentError::Invalid("The selected asset is not an image."));
        }
        let original = media.read_asset(id)?;
        let decoded = image::load_from_memory(&original.bytes)
            .map_err(|error| PersistenceError::failure("decode model image", error))?;
        let mut output = Cursor::new(Vec::new());
        decoded
            .thumbnail(1536, 1536)
            .write_to(&mut output, image::ImageFormat::Png)
            .map_err(|error| PersistenceError::failure("encode model image", error))?;
        let bytes = output.into_inner();
        self.image_sources
            .lock()
            .map_err(|_error| AgentError::Locked)?
            .insert(BlobId::for_bytes(&bytes), id.to_owned());
        Ok(Image {
            data: DocumentSourceKind::Raw(bytes),
            media_type: Some(ImageMediaType::PNG),
            ..Image::default()
        })
    }

    pub(super) fn hydrate_images(
        &self,
        media: &MediaLibrary,
        messages: &mut [Message],
    ) -> Result<(), AgentError> {
        for message in messages {
            for image in message.images_mut() {
                if let DocumentSourceKind::Url(url) = &image.data {
                    let id = url.strip_prefix(ASSET_PREFIX).ok_or(AgentError::Invalid(
                        "The saved conversation contains an unsupported image reference.",
                    ))?;
                    *image = self.model_image(media, id)?;
                }
            }
        }
        Ok(())
    }

    pub(super) fn retain_image_references(
        &self,
        messages: &mut [Message],
    ) -> Result<(), AgentError> {
        let sources = self
            .image_sources
            .lock()
            .map_err(|_error| AgentError::Locked)?;
        retain_references(messages, &sources)
    }
}

/// The persisted transcript contains asset identities, never duplicated image payloads.
pub(super) fn retain_references(
    messages: &mut [Message],
    sources: &std::collections::HashMap<BlobId, String>,
) -> Result<(), AgentError> {
    for message in messages {
        for image in message.images_mut() {
            if let DocumentSourceKind::Raw(bytes) = &image.data {
                let id = sources
                    .get(&BlobId::for_bytes(bytes))
                    .ok_or(AgentError::Invalid(
                        "The model returned an untracked image.",
                    ))?;
                image.data = DocumentSourceKind::Url(format!("{ASSET_PREFIX}{id}"));
                image.native = None;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
