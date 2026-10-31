//! Resolve application asset identities into SDK inputs at local preparation boundaries.

use novelai_bridge::{
    CharacterReference, EncodeVibeRequest, GenerateImageRequest, GenerationDelivery,
    GenerationInput, ImageToImageInput, InpaintingInput, ReferenceSet, RunDirectorToolRequest,
    UpscaleImageRequest, VibeReference, VibeTransferConfig,
};

use super::{FrozenSubmission, JobError, JobQueue, ParameterDiagnostic};
use crate::{
    api::UserMessage,
    media::AssetReader,
    prompt::{ResolvedDraft, ResolvedSettings},
    session::{CreationInputs, CreationOperation, Draft, VibeInput, validate_draft},
};

mod quote;

/// Kept only for the current local preparation; frozen records contain no image payloads.
enum QuoteBasis {
    Generation(Box<novelai_bridge::PreparedGeneration>),
    Director(novelai_bridge::PreparedDirector),
    EncodeVibe(novelai_bridge::Model),
    Upscale(Option<u32>),
}

/// Shared SDK validation and effective fields; persistence-only data is built on submission.
struct GenerationPreparation {
    resolved: ResolvedDraft,
    prepared: novelai_bridge::PreparedGeneration,
    diagnostics: Vec<ParameterDiagnostic>,
    stream_body: Option<Vec<u8>>,
}

impl GenerationPreparation {
    fn freeze(
        mut self,
    ) -> Result<(FrozenSubmission, novelai_bridge::PreparedGeneration), JobError> {
        let mut request = self.prepared.normalized().request().clone();
        request.core.seed = self.prepared.resolved_seed();
        freeze_extra_noise_seed(
            &mut self.resolved.inputs,
            &self.prepared,
            self.stream_body.as_deref(),
        )?;
        // Persist only SDK parameters and immutable asset IDs, never copied image payloads.
        request.operation = GenerationInput::TextToImage;
        request.references = None;
        let submission = FrozenSubmission::Generation {
            seed: request.core.seed,
            resolved: Box::new(self.resolved),
            request: Box::new(request),
            diagnostics: self.diagnostics,
        };
        Ok((submission, self.prepared))
    }
}

impl JobQueue {
    fn resolve_generation(&self, draft: &Draft) -> Result<ResolvedDraft, JobError> {
        validate_draft(draft).map_err(|error| {
            JobError::Invalid(UserMessage::Validation {
                field: error.field,
                message: Box::new(error.message),
            })
        })?;
        Ok(self.resolver.resolve(draft)?)
    }

    pub(super) fn freeze(&self, draft: &Draft) -> Result<FrozenSubmission, JobError> {
        self.prepare_submission(draft)
            .map(|(submission, _)| submission)
    }

    fn prepare_submission(
        &self,
        draft: &Draft,
    ) -> Result<(FrozenSubmission, QuoteBasis), JobError> {
        match &draft.inputs.operation {
            CreationOperation::Director { asset_id, command } => {
                let command = compile_director(command)?;
                let prepared = RunDirectorToolRequest {
                    image: image(self.assets.as_ref(), asset_id)?,
                    command,
                    policy: draft.inputs.policy,
                }
                .prepare()?;
                let submission = FrozenSubmission::Director {
                    asset_id: asset_id.clone(),
                    policy: draft.inputs.policy,
                    command: prepared.command().clone(),
                    diagnostics: adjustments(prepared.adjustments()),
                };
                Ok((submission, QuoteBasis::Director(prepared)))
            },
            CreationOperation::EncodeVibe(crate::session::VibeEncodingInput {
                asset_id,
                model,
                information_extracted,
                mask_asset_id,
                crop_to_mask,
                focus_seed,
                info_extract_seed,
            }) => {
                let prepared = EncodeVibeRequest {
                    image: image(self.assets.as_ref(), asset_id)?,
                    model: *model,
                    information_extracted: *information_extracted,
                    mask: mask_asset_id
                        .as_ref()
                        .map(|id| image(self.assets.as_ref(), id))
                        .transpose()?,
                    crop_to_mask: *crop_to_mask,
                    focus_seed: *focus_seed,
                    info_extract_seed: *info_extract_seed,
                    policy: draft.inputs.policy,
                }
                .prepare()?;
                let submission = FrozenSubmission::EncodeVibe {
                    asset_id: asset_id.clone(),
                    policy: draft.inputs.policy,
                    model: prepared.model(),
                    information_extracted: prepared.information_extracted(),
                    mask_asset_id: mask_asset_id.clone(),
                    crop_to_mask: *crop_to_mask,
                    focus_seed: *focus_seed,
                    info_extract_seed: *info_extract_seed,
                    diagnostics: adjustments(prepared.adjustments()),
                };
                Ok((submission, QuoteBasis::EncodeVibe(prepared.model())))
            },
            CreationOperation::Upscale {
                asset_id,
                model,
                declared_blur_sigma,
            } => {
                let prepared = UpscaleImageRequest {
                    image: image(self.assets.as_ref(), asset_id)?,
                    model: *model,
                    declared_blur_sigma: *declared_blur_sigma,
                }
                .prepare()?;
                let submission = FrozenSubmission::Upscale {
                    asset_id: asset_id.clone(),
                    model: prepared.model(),
                    declared_blur_sigma: prepared.declared_blur_sigma(),
                    diagnostics: Vec::new(),
                };
                Ok((submission, QuoteBasis::Upscale(prepared.estimated_cost())))
            },
            _ => {
                let resolved = self.resolve_generation(draft)?;
                let preparation = prepare_generation(resolved, self.assets.as_ref())?;
                let (submission, prepared) = preparation.freeze()?;
                Ok((submission, QuoteBasis::Generation(Box::new(prepared))))
            },
        }
    }

    pub(super) fn freeze_batch(&self, draft: &Draft) -> Result<Vec<FrozenSubmission>, JobError> {
        if matches!(
            draft.inputs.operation,
            CreationOperation::TextToImage
                | CreationOperation::ImageToImage { .. }
                | CreationOperation::Inpainting { .. }
        ) {
            let count = draft.inputs.request_count;
            if !(1..=8).contains(&count) {
                return Err(JobError::Invalid(UserMessage::RequestCountRange));
            }
            let mut resolved = self.resolve_generation(draft)?;
            resolved.inputs.request_count = 1;
            // Resource resolution happens once. Each SDK preparation independently resolves auto seeds.
            (0..count)
                .map(|_| {
                    prepare_generation(resolved.clone(), self.assets.as_ref())?
                        .freeze()
                        .map(|value| value.0)
                })
                .collect()
        } else {
            self.prepare_submission(draft).map(|value| vec![value.0])
        }
    }
}

#[cfg(test)]
pub(crate) fn prepare_submission(
    resolved: ResolvedDraft,
    assets: &dyn AssetReader,
) -> Result<FrozenSubmission, JobError> {
    prepare_generation(resolved, assets)?
        .freeze()
        .map(|value| value.0)
}

fn prepare_generation(
    mut resolved: ResolvedDraft,
    assets: &dyn AssetReader,
) -> Result<GenerationPreparation, JobError> {
    validate_resolved_prompts(&resolved)?;
    let request = hydrate(resolved.generation_request(), &resolved.inputs, assets)?;
    let prepared = request.normalize()?.prepare()?;
    if !prepared
        .normalized()
        .request()
        .descriptor()
        .support()
        .streaming
    {
        resolved.inputs.stream = None;
    }
    // Encoding checks SDK delivery support locally; no request is sent here.
    let stream_body = resolved
        .inputs
        .stream
        .map(|mode| prepared.encode(GenerationDelivery::Stream(mode)))
        .transpose()?;
    let normalized = prepared.normalized();
    let diagnostics = normalized
        .diagnostics()
        .iter()
        .map(|diagnostic| ParameterDiagnostic {
            field: diagnostic.field.to_string(),
            change: match &diagnostic.change {
                novelai_bridge::NormalizationChange::Adjusted { from, to } => {
                    UserMessage::NumericAdjusted {
                        from: from.to_string(),
                        to: to.to_string(),
                    }
                },
                novelai_bridge::NormalizationChange::Unsupported => {
                    UserMessage::UnsupportedParameterRemoved
                },
                novelai_bridge::NormalizationChange::Fallback => {
                    if diagnostic.field == novelai_bridge::GenerationField::Model {
                        UserMessage::ModelFallback {
                            model: normalized.request().core.model.as_str().to_owned(),
                        }
                    } else {
                        UserMessage::ParameterFallback
                    }
                },
                novelai_bridge::NormalizationChange::Conflict { retained_field } => {
                    UserMessage::ParameterConflict {
                        retained_field: retained_field.to_string(),
                    }
                },
                novelai_bridge::NormalizationChange::CharacterLimit { limit, .. } => {
                    UserMessage::CharacterLimit {
                        limit: (*limit) as usize,
                    }
                },
                _ => UserMessage::ParameterNormalized,
            },
        })
        .collect();
    let request = normalized.request();
    resolved
        .positive
        .clone_from(&normalized.resolved_prompts().prompt);
    resolved
        .negative
        .clone_from(&normalized.resolved_prompts().negative_prompt);
    resolved.settings = ResolvedSettings::from_request(request);
    resolved.settings.seed = prepared.resolved_seed();
    if request.characters.is_none() {
        resolved.characters.clear();
        resolved
            .prompt_analysis
            .retain(|analysis| analysis.character_id.is_none());
    }
    for (source, effective) in resolved
        .characters
        .iter_mut()
        .zip(request.characters.iter().flat_map(|set| &set.characters))
    {
        source.enabled = effective.enabled;
        source.position = effective.position;
    }
    for effective in &normalized.resolved_prompts().characters {
        if let Some(source) = resolved.characters.get_mut(effective.index) {
            source.positive.clone_from(&effective.prompt);
            source.negative.clone_from(&effective.negative_prompt);
        }
    }
    sync_inputs(&mut resolved.inputs, request);
    Ok(GenerationPreparation {
        resolved,
        prepared,
        diagnostics,
        stream_body,
    })
}

/// Rejects editable source failures before preparing media or SDK parameters.
fn validate_resolved_prompts(resolved: &ResolvedDraft) -> Result<(), JobError> {
    if !resolved.issues.is_empty() {
        return Err(JobError::Unresolved);
    }
    let diagnostics = resolved
        .prompt_analysis
        .iter()
        .flat_map(|analysis| analysis.document.source_diagnostics.iter().cloned())
        .collect::<Vec<_>>();
    if !diagnostics.is_empty() {
        return Err(JobError::PromptSource { diagnostics });
    }
    Ok(())
}

/// Director prompts are editable nib source, but have no image-model syntax profile.
fn compile_director(
    command: &novelai_bridge::DirectorCommand,
) -> Result<novelai_bridge::DirectorCommand, JobError> {
    let mut command = command.clone();
    let prompt = match &mut command {
        novelai_bridge::DirectorCommand::Emotion { prompt, .. } => Some(prompt),
        novelai_bridge::DirectorCommand::Colorize { prompt, .. } => prompt.as_mut(),
        _ => None,
    };
    if let Some(prompt) = prompt {
        let compiled = nib_prompt::compile(prompt, nib_prompt::PromptSyntaxProfile::default());
        if !compiled.diagnostics.is_empty() {
            return Err(JobError::PromptSource {
                diagnostics: compiled.diagnostics,
            });
        }
        *prompt = compiled.text;
    }
    Ok(command)
}

fn adjustments(values: &[novelai_bridge::ValidationAdjustment]) -> Vec<ParameterDiagnostic> {
    values
        .iter()
        .map(|value| ParameterDiagnostic {
            field: value.field.to_string(),
            change: UserMessage::NumericAdjusted {
                from: value.from.to_string(),
                to: value.to.to_string(),
            },
        })
        .collect()
}

fn freeze_extra_noise_seed(
    inputs: &mut CreationInputs,
    prepared: &novelai_bridge::PreparedGeneration,
    encoded_body: Option<&[u8]>,
) -> Result<(), JobError> {
    #[derive(serde::Deserialize)]
    struct NoiseSeed {
        extra_noise_seed: Option<i64>,
    }
    #[derive(serde::Deserialize)]
    struct Parameters {
        extra_noise_seed: Option<i64>,
        img2img: Option<NoiseSeed>,
    }
    #[derive(serde::Deserialize)]
    struct Payload {
        parameters: Parameters,
    }
    let (slot, inpainting) = match &mut inputs.operation {
        CreationOperation::ImageToImage {
            extra_noise_seed, ..
        } => (extra_noise_seed, false),
        CreationOperation::Inpainting {
            img2img: Some(input),
            ..
        } => (&mut input.extra_noise_seed, true),
        _ => return Ok(()),
    };
    if slot.is_some() {
        return Ok(());
    }
    // The SDK exposes this implicit effective value only in its prepared payload.
    // Freezing it keeps result reuse independent from a later per-sample seed change.
    let encoded;
    let bytes = if let Some(bytes) = encoded_body {
        bytes
    } else {
        encoded = prepared.encode(GenerationDelivery::Images)?;
        &encoded
    };
    // Ignore media fields while deserializing instead of copying their base64 strings.
    let body: Payload = serde_json::from_slice(bytes).map_err(|error| {
        crate::persistence::PersistenceError::failure("read the SDK effective noise seed", error)
    })?;
    let seed = if inpainting {
        body.parameters
            .img2img
            .and_then(|input| input.extra_noise_seed)
    } else {
        body.parameters.extra_noise_seed
    };
    *slot = Some(seed.ok_or_else(|| JobError::Invalid(UserMessage::MissingNoiseSeed))?);
    Ok(())
}

pub(super) fn hydrate(
    mut request: GenerateImageRequest,
    inputs: &CreationInputs,
    assets: &dyn AssetReader,
) -> Result<GenerateImageRequest, JobError> {
    request.operation = match &inputs.operation {
        CreationOperation::TextToImage => GenerationInput::TextToImage,
        CreationOperation::ImageToImage {
            asset_id,
            strength,
            noise,
            color_correct,
            extra_noise_seed,
            add_original_image,
            max_enhance,
        } => GenerationInput::ImageToImage(ImageToImageInput {
            image: image(assets, asset_id)?,
            strength: *strength,
            noise: *noise,
            color_correct: *color_correct,
            extra_noise_seed: *extra_noise_seed,
            add_original_image: *add_original_image,
            max_enhance: *max_enhance,
        }),
        CreationOperation::Inpainting {
            asset_id,
            mask_asset_id,
            img2img,
            add_original_image,
        } => GenerationInput::Inpainting(InpaintingInput {
            image: image(assets, asset_id)?,
            mask: image(assets, mask_asset_id)?,
            img2img: img2img.clone(),
            add_original_image: *add_original_image,
        }),
        _ => return Err(JobError::Invalid(UserMessage::NotImageGeneration)),
    };
    let references = &inputs.references;
    let suppress_vibes = references
        .resolution(request.core.model, request.mode())
        .vibe
        == novelai_bridge::ReferenceAvailability::ConflictWithCharacterReference;
    let precise = references
        .precise
        .iter()
        .filter(|item| item.enabled)
        .map(|item| {
            Ok(CharacterReference {
                image: image(assets, &item.asset_id)?,
                reference_type: item.reference_type,
                strength: item.strength,
                fidelity: item.fidelity,
                information_extracted: item.information_extracted,
            })
        })
        .collect::<Result<Vec<_>, JobError>>()?;
    let vibes = references
        .vibes
        .iter()
        // The editor retains these entries, but hidden Vibe media must neither be read nor
        // reach strict SDK validation when an applicable precise reference takes precedence.
        .filter(|item| item.enabled && !suppress_vibes)
        .map(|item| {
            Ok(match &item.input {
                VibeInput::Encoded { asset_id } => VibeReference::encoded(
                    assets
                        .vibe(asset_id)
                        .map_err(|source| JobError::InputMedia { source })?,
                    item.strength,
                ),
                VibeInput::Image {
                    asset_id,
                    information_extracted,
                } => VibeReference::image(
                    image(assets, asset_id)?,
                    *information_extracted,
                    item.strength,
                ),
            })
        })
        .collect::<Result<Vec<_>, JobError>>()?;
    let references = ReferenceSet {
        character_references: precise,
        vibe_transfer: (!vibes.is_empty()).then(|| {
            let mut config = VibeTransferConfig::new(vibes);
            if let Some(normalize) = references.normalize_vibe_strength {
                config.normalize_strength = normalize;
            }
            config
        }),
    };
    request.references = (!references.is_empty()).then_some(references);
    Ok(request)
}

fn sync_inputs(inputs: &mut CreationInputs, request: &GenerateImageRequest) {
    match (&mut inputs.operation, &request.operation) {
        (
            CreationOperation::ImageToImage {
                strength,
                noise,
                color_correct,
                extra_noise_seed,
                add_original_image,
                max_enhance,
                ..
            },
            GenerationInput::ImageToImage(value),
        ) => {
            *strength = value.strength;
            *noise = value.noise;
            *color_correct = value.color_correct;
            *extra_noise_seed = value.extra_noise_seed;
            *add_original_image = value.add_original_image;
            *max_enhance = value.max_enhance;
        },
        (
            CreationOperation::Inpainting {
                img2img,
                add_original_image,
                ..
            },
            GenerationInput::Inpainting(value),
        ) => {
            img2img.clone_from(&value.img2img);
            *add_original_image = value.add_original_image;
        },
        _ => {},
    }
    let references = request.references.as_ref();
    inputs.references.precise.retain(|item| item.enabled);
    inputs.references.vibes.retain(|item| item.enabled);
    if let Some(references) = references {
        if references.character_references.is_empty() {
            inputs.references.precise.clear();
        }
        for (item, value) in inputs
            .references
            .precise
            .iter_mut()
            .zip(&references.character_references)
        {
            item.strength = value.strength;
            item.fidelity = value.fidelity;
            item.reference_type = value.reference_type;
            item.information_extracted = value.information_extracted;
        }
        if let Some(vibe) = &references.vibe_transfer {
            inputs.references.normalize_vibe_strength = Some(vibe.normalize_strength);
            for (item, value) in inputs.references.vibes.iter_mut().zip(&vibe.references) {
                item.strength = value.strength;
                if let (
                    VibeInput::Image {
                        information_extracted,
                        ..
                    },
                    novelai_bridge::VibeReferenceInput::Image {
                        information_extracted: effective,
                        ..
                    },
                ) = (&mut item.input, &value.input)
                {
                    *information_extracted = *effective;
                }
            }
        } else {
            inputs.references.vibes.clear();
            inputs.references.normalize_vibe_strength = None;
        }
    } else {
        inputs.references.precise.clear();
        inputs.references.vibes.clear();
        inputs.references.normalize_vibe_strength = None;
    }
}

pub(super) fn image(
    assets: &dyn AssetReader,
    id: &str,
) -> Result<novelai_bridge::EncodedImage, JobError> {
    assets
        .image(id)
        .map_err(|source| JobError::InputMedia { source })
}
