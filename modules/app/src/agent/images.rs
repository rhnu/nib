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
    media::{AssetKind, BlobId, MediaLibrary},
    state::AppState,
};

const ASSET_PREFIX: &str = "nib-asset:";
pub(super) const MAX_ATTACHMENTS: usize = 4;

pub(super) fn tools(runtime: &Arc<AgentRuntime>, app: &AppState) -> Vec<DynamicTool> {
    [
        ("read_image", "Read an image asset by its assetId (from creation inputs, attachments or saved results) and return actual image content for visual analysis.", json!({"assetId":{"type":"string"}}), vec!["assetId"]),
        ("list_image_results", "List saved image results, newest first, optionally for one job. Returns assetId for read_image and a pagination cursor. This does not generate images.", json!({"jobId":{"type":["string","null"]},"before":{"type":["string","null"]}}), vec![]),
    ].into_iter().map(|(name, description, properties, required)| {
        let runtime=Arc::clone(runtime); let app=app.clone();
        DynamicTool::new(ToolName::new(name).expect("static name"), description, json!({"type":"object","properties":properties,"required":required,"additionalProperties":false}), move |args| {
            let runtime=Arc::clone(&runtime); let app=app.clone();
            Box::pin(async move {
                let activity=runtime.tool_activity(); let worker=Arc::clone(&runtime);
                let access=app.write_access().await.map_err(|_error|ToolExecutionError::other("Creation data is not writable."))?;
                tokio::task::spawn_blocking(move || {
                    let _activity=activity; let _access=access;
                    let mut asset_ids=vec![];
                    let result=(|| {
                        if worker.cancelled.load(Ordering::Acquire) { return Err(AgentError::Cancelled); }
                        let media=app.media()?;
                        if name=="read_image" {
                            #[derive(Deserialize)]
                            #[serde(rename_all="camelCase",deny_unknown_fields)]
                            struct Args { asset_id:String }
                            let args:Args=serde_json::from_value(args).map_err(|_error|AgentError::Invalid("Provide an image assetId."))?;
                            let image=worker.model_image(&media,&args.asset_id)?;
                            asset_ids.push(args.asset_id.clone());
                            ToolOutput::content(vec![ToolResultContent::json(json!({"assetId":args.asset_id})),ToolResultContent::Image(image)]).map_err(|_error|AgentError::Locked)
                        } else {
                            #[derive(Deserialize)]
                            #[serde(rename_all="camelCase",deny_unknown_fields)]
                            struct Args { job_id:Option<String>, before:Option<String> }
                            let args:Args=serde_json::from_value(args).map_err(|_error|AgentError::Invalid("Provide optional jobId and before fields."))?;
                            let page=media.list(&crate::media::ResultQuery { kind:Some(AssetKind::Image),job_id:args.job_id,before:args.before,limit:20 })?;
                            Ok(ToolOutput::json(serde_json::to_value(page).map_err(|_error|AgentError::Locked)?))
                        }
                    })();
                    super::tools::record_output(&worker,name,result,asset_ids)
                }).await.map_err(|_error|ToolExecutionError::other("The image worker failed."))?
            })
        })
    }).collect()
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
                "The conversation reached its image limit. Clear it before adding more images.",
            ));
        }
        drop(sources);
        let asset = media.asset(id)?;
        if asset.kind != AssetKind::Image {
            return Err(AgentError::Invalid("The selected asset is not an image."));
        }
        let original = media.read_asset(id)?;
        let decoded = image::load_from_memory(&original.bytes)
            .map_err(|_error| AgentError::Invalid("The image could not be decoded."))?;
        let mut output = Cursor::new(Vec::new());
        decoded
            .thumbnail(1536, 1536)
            .write_to(&mut output, image::ImageFormat::Png)
            .map_err(|_error| {
                AgentError::Invalid("The image could not be prepared for the model.")
            })?;
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
