//! Explicit media dependencies owned by persisted domain records.
use std::collections::BTreeSet;

use rusqlite::{Connection, params};

use super::{AssetSource, MediaAsset};
use crate::{
    jobs::FrozenSubmission,
    persistence::PersistenceError,
    prompt::{PresetBinding, Resource, ResourceContent},
    session::{CreationInputs, CreationOperation, Draft, ReferenceInputs, VibeEncodingInput},
};

type AssetIds<'a> = BTreeSet<&'a str>;

fn reference_ids<'a>(references: &'a ReferenceInputs, ids: &mut AssetIds<'a>) {
    // Disabled materials remain editable and must retain their inputs too.
    ids.extend(
        references
            .precise
            .iter()
            .map(|value| value.asset_id.as_str()),
    );
    ids.extend(references.vibes.iter().map(|value| value.input.asset_id()));
}

fn encoding_ids<'a>(input: &'a VibeEncodingInput, ids: &mut AssetIds<'a>) {
    ids.insert(&input.asset_id);
    ids.extend(input.mask_asset_id.as_deref());
}

fn input_ids<'a>(inputs: &'a CreationInputs, ids: &mut AssetIds<'a>) {
    match &inputs.operation {
        CreationOperation::TextToImage => {},
        CreationOperation::ImageToImage { asset_id, .. }
        | CreationOperation::Director { asset_id, .. }
        | CreationOperation::Upscale { asset_id, .. } => {
            ids.insert(asset_id);
        },
        CreationOperation::Inpainting {
            asset_id,
            mask_asset_id,
            ..
        } => {
            ids.insert(asset_id);
            ids.insert(mask_asset_id);
        },
        CreationOperation::EncodeVibe(input) => encoding_ids(input, ids),
    }
    reference_ids(&inputs.references, ids);
}

fn resource_ids(resource: &Resource) -> AssetIds<'_> {
    let mut ids = AssetIds::new();
    ids.extend(resource.cover_asset_id.as_deref());
    if let ResourceContent::Preset { references, .. } = &resource.content {
        reference_ids(references, &mut ids);
    }
    ids
}

fn creation_ids(draft: &Draft) -> AssetIds<'_> {
    let mut ids = AssetIds::new();
    input_ids(&draft.inputs, &mut ids);
    for preset in &draft.presets {
        match &preset.binding {
            PresetBinding::Expanded { references, .. } => reference_ids(references, &mut ids),
            PresetBinding::Linked {
                output_overrides, ..
            } => {
                ids.extend(
                    output_overrides
                        .precise
                        .iter()
                        .filter_map(|edit| edit.asset_id.as_deref()),
                );
                ids.extend(output_overrides.vibes.iter().filter_map(|edit| {
                    edit.input.as_ref().map(crate::session::VibeInput::asset_id)
                }));
            },
        }
    }
    for session in &draft.mask_editor.sessions {
        ids.insert(&session.source_asset_id);
        ids.extend(session.base_mask_asset_id.as_deref());
        ids.extend(session.applied_mask_asset_id.as_deref());
    }
    if let Some(input) = &draft.vibe_encoder {
        encoding_ids(input, &mut ids);
    }
    ids.extend(
        draft
            .director
            .tools
            .iter()
            .filter_map(|tool| tool.asset_id.as_deref()),
    );
    for session in &draft.png_text_editor.sessions {
        ids.insert(&session.asset_id);
        ids.extend(session.selected_output_asset_id.as_deref());
    }
    ids
}

fn job_ids(submission: &FrozenSubmission) -> AssetIds<'_> {
    let mut ids = AssetIds::new();
    match submission {
        FrozenSubmission::Generation { resolved, .. } => input_ids(&resolved.inputs, &mut ids),
        FrozenSubmission::Director { asset_id, .. }
        | FrozenSubmission::Upscale { asset_id, .. } => {
            ids.insert(asset_id);
        },
        FrozenSubmission::EncodeVibe {
            asset_id,
            mask_asset_id,
            ..
        } => {
            ids.insert(asset_id);
            ids.extend(mask_asset_id.as_deref());
        },
    }
    ids
}

fn source_ids(source: &AssetSource) -> AssetIds<'_> {
    let mut ids = AssetIds::new();
    match source {
        AssetSource::Asset { asset_id }
        | AssetSource::EmbeddedVibe { asset_id, .. }
        | AssetSource::VibeDocumentEntry { asset_id, .. } => {
            ids.insert(asset_id);
        },
        AssetSource::PngVibeDocument {
            image_asset_id,
            document_asset_id,
        } => {
            ids.insert(image_asset_id);
            ids.insert(document_asset_id);
        },
        AssetSource::VibeBundle { asset_ids } => ids.extend(asset_ids.iter().map(String::as_str)),
        // Job inputs are retained by the job's own references; these are provenance only.
        AssetSource::ResourceCover { .. }
        | AssetSource::Import { .. }
        | AssetSource::Job { .. } => {},
    }
    ids
}

/// Replaces one owner's dependencies inside its caller's write transaction.
fn replace_on(
    connection: &Connection,
    kind: &str,
    id: &str,
    ids: AssetIds<'_>,
) -> Result<(), PersistenceError> {
    // Validate first so a missing target is reported explicitly rather than as a foreign-key error.
    for asset_id in &ids {
        let exists: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM media_assets WHERE id=?1)",
                [asset_id],
                |row| row.get(0),
            )
            .map_err(|error| {
                PersistenceError::failure("inspect a media reference target", error)
            })?;
        if !exists {
            return Err(PersistenceError::NotFound {
                kind: "media asset",
                id: (*asset_id).to_owned(),
            });
        }
    }
    remove_owner_on(connection, kind, id)?;
    for asset_id in ids {
        connection
            .execute(
                "INSERT INTO media_references(owner_kind,owner_id,asset_id) VALUES (?1,?2,?3)",
                params![kind, id, asset_id],
            )
            .map_err(|error| PersistenceError::failure("retain a media reference", error))?;
    }
    Ok(())
}

pub(crate) fn sync_resource_on(
    connection: &Connection,
    resource: &Resource,
) -> Result<(), PersistenceError> {
    replace_on(connection, "resource", &resource.id, resource_ids(resource))
}

pub(crate) fn sync_creation_on(
    connection: &Connection,
    draft: &Draft,
) -> Result<(), PersistenceError> {
    replace_on(connection, "creation", "1", creation_ids(draft))
}

pub(crate) fn sync_job_on(
    connection: &Connection,
    job_id: &str,
    submission: &FrozenSubmission,
) -> Result<(), PersistenceError> {
    replace_on(connection, "job", job_id, job_ids(submission))
}

pub(crate) fn sync_asset_on(
    connection: &Connection,
    asset: &MediaAsset,
) -> Result<(), PersistenceError> {
    replace_on(connection, "asset", &asset.id, source_ids(&asset.source))
}

pub(crate) fn sync_result_on(
    connection: &Connection,
    result_id: &str,
    asset_id: &str,
) -> Result<(), PersistenceError> {
    replace_on(connection, "result", result_id, BTreeSet::from([asset_id]))
}

pub(crate) fn remove_owner_on(
    connection: &Connection,
    kind: &str,
    id: &str,
) -> Result<(), PersistenceError> {
    connection
        .execute(
            "DELETE FROM media_references WHERE owner_kind=?1 AND owner_id=?2",
            params![kind, id],
        )
        .map_err(|error| PersistenceError::failure("remove an owner's media references", error))?;
    Ok(())
}

#[cfg(test)]
mod tests;
