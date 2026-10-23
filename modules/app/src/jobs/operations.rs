//! Resolve application asset identities into SDK inputs at local preparation boundaries.
use novelai_bridge::{
    AnlasPricingContext, CharacterReference, EncodeVibeRequest, GenerateImageRequest,
    GenerationDelivery, GenerationInput, ImageToImageInput, InpaintingInput, ReferenceSet,
    RunDirectorToolRequest, UpscaleImageRequest, VibeReference, VibeTransferConfig,
};

use super::{
    FrozenSubmission, GenerationQuote, JobError, JobQueue, ParameterDiagnostic, TokenFieldUsage,
};
use crate::{
    media::AssetReader,
    prompt::{ResolvedDraft, ResolvedSettings},
    session::{CreationInputs, CreationOperation, Draft, VibeInput, validate_draft},
};

impl JobQueue {
    pub(super) fn freeze(&self, draft: &Draft) -> Result<FrozenSubmission, JobError> {
        match &draft.inputs.operation {
            CreationOperation::Director { asset_id, command } => {
                let prepared = RunDirectorToolRequest {
                    image: image(self.assets.as_ref(), asset_id)?,
                    command: command.clone(),
                    policy: draft.inputs.policy,
                }
                .prepare()?;
                Ok(FrozenSubmission::Director {
                    asset_id: asset_id.clone(),
                    policy: draft.inputs.policy,
                    command: prepared.command().clone(),
                    diagnostics: adjustments(prepared.adjustments()),
                })
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
                Ok(FrozenSubmission::EncodeVibe {
                    asset_id: asset_id.clone(),
                    policy: draft.inputs.policy,
                    model: prepared.model(),
                    information_extracted: prepared.information_extracted(),
                    mask_asset_id: mask_asset_id.clone(),
                    crop_to_mask: *crop_to_mask,
                    focus_seed: *focus_seed,
                    info_extract_seed: *info_extract_seed,
                    diagnostics: adjustments(prepared.adjustments()),
                })
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
                Ok(FrozenSubmission::Upscale {
                    asset_id: asset_id.clone(),
                    model: prepared.model(),
                    declared_blur_sigma: prepared.declared_blur_sigma(),
                    diagnostics: Vec::new(),
                })
            },
            _ => {
                validate_draft(draft).map_err(|error| JobError::Invalid(error.to_string()))?;
                let resolved = self.resolver.resolve(draft)?;
                prepare_submission(resolved, self.assets.as_ref())
            },
        }
    }

    pub(super) fn quote_submission(
        &self,
        submission: FrozenSubmission,
    ) -> Result<GenerationQuote, JobError> {
        let subscription = self
            .clients
            .cached_client()
            .and_then(|client| client.last_subscription());
        let context = subscription
            .as_ref()
            .map_or_else(AnlasPricingContext::default, AnlasPricingContext::from);
        let operation = submission.operation();
        let diagnostics = submission.diagnostics().to_vec();
        let mut geometry = None;
        let (resolved, estimated_anlas, too_expensive, tokens) = match submission {
            FrozenSubmission::Generation {
                resolved, request, ..
            } => {
                let hydrated = hydrate(*request, &resolved.inputs, self.assets.as_ref())?;
                let plan = hydrated.normalize()?;
                geometry = Some(*plan.geometry());
                let estimate =
                    novelai_bridge::estimate_anlas_cost(plan.anlas_estimate_input(context));
                let usage = plan
                    .count_tokens(&self.tokenizers)
                    .map_err(novelai_bridge::BridgeError::from)?;
                let tokens = token_usage_fields(usage);
                (
                    Some(*resolved),
                    Some(estimate.total),
                    estimate.is_too_expensive(),
                    tokens,
                )
            },
            FrozenSubmission::Director {
                asset_id,
                command,
                policy,
                ..
            } => (
                None,
                Some(
                    RunDirectorToolRequest {
                        image: image(self.assets.as_ref(), &asset_id)?,
                        command,
                        policy,
                    }
                    .prepare()?
                    .estimate_anlas_cost(context),
                ),
                false,
                Vec::new(),
            ),
            FrozenSubmission::EncodeVibe { model, .. } => (
                None,
                Some(
                    novelai_bridge::estimate_anlas_cost(novelai_bridge::AnlasEstimateInput {
                        model,
                        pending_vibe_encodes: 1,
                        context,
                        ..Default::default()
                    })
                    .vibe_encoding,
                ),
                false,
                Vec::new(),
            ),
            FrozenSubmission::Upscale { asset_id, .. } => (
                None,
                novelai_bridge::estimate_upscale_cost(
                    image(self.assets.as_ref(), &asset_id)?.size(),
                ),
                false,
                Vec::new(),
            ),
        };
        let account_sampled_at = if subscription.is_some() {
            *self
                .account_sampled_at
                .lock()
                .map_err(|_poisoned| crate::persistence::PersistenceError::Locked)?
        } else {
            None
        };
        Ok(GenerationQuote {
            operation,
            resolved,
            estimated_anlas,
            geometry,
            account_specific: subscription.is_some(),
            too_expensive,
            tokens,
            diagnostics,
            account_sampled_at,
        })
    }
}

/// Projects per-conditioning usage without combining independent SDK prompt budgets.
fn token_usage_fields(usage: novelai_bridge::PromptTokenUsage) -> Vec<TokenFieldUsage> {
    let mut tokens = vec![
        token_field("prompt".to_owned(), usage.prompt),
        token_field("negativePrompt".to_owned(), usage.negative_prompt),
    ];
    for character in usage.characters {
        tokens.push(token_field(
            format!("characters[{}].prompt", character.index),
            character.prompt,
        ));
        tokens.push(token_field(
            format!("characters[{}].negativePrompt", character.index),
            character.negative_prompt,
        ));
    }
    tokens
}

fn token_field(field: String, count: novelai_bridge::TokenCount) -> TokenFieldUsage {
    TokenFieldUsage {
        field,
        used: count.used,
        limit: count.limit,
        over_limit: count.is_over_limit(),
    }
}

pub(crate) fn prepare_submission(
    mut resolved: ResolvedDraft,
    assets: &dyn AssetReader,
) -> Result<FrozenSubmission, JobError> {
    if !resolved.issues.is_empty() {
        return Err(JobError::Unresolved);
    }
    let request = hydrate(resolved.generation_request(), &resolved.inputs, assets)?;
    let prepared = request.normalize()?.prepare()?;
    // Encoding checks SDK delivery support locally; no request is sent here.
    if let Some(mode) = resolved.inputs.stream {
        prepared.encode(GenerationDelivery::Stream(mode))?;
    }
    let normalized = prepared.normalized();
    let diagnostics = normalized
        .diagnostics()
        .iter()
        .map(|diagnostic| ParameterDiagnostic {
            field: diagnostic.field.to_string(),
            change: match &diagnostic.change {
                novelai_bridge::NormalizationChange::Adjusted { from, to } => {
                    format!("已从 {from} 调整为 {to}。")
                },
                novelai_bridge::NormalizationChange::Unsupported => {
                    "所选模型不支持，已移除。".to_owned()
                },
                novelai_bridge::NormalizationChange::Fallback => {
                    if diagnostic.field == novelai_bridge::GenerationField::Model {
                        format!("已改用 {}。", normalized.request().core.model.as_str())
                    } else {
                        "已替换为所选模型支持的值。".to_owned()
                    }
                },
                novelai_bridge::NormalizationChange::Conflict { retained_field } => {
                    format!("与 {retained_field} 冲突，已移除。")
                },
                novelai_bridge::NormalizationChange::CharacterLimit { limit, .. } => {
                    format!("超过模型的 {limit} 个角色上限，已停用。")
                },
                _ => "SDK 已规范化该参数。".to_owned(),
            },
        })
        .collect();
    let mut request = normalized.request().clone();
    request.core.seed = prepared.resolved_seed();
    resolved
        .positive
        .clone_from(&normalized.resolved_prompts().prompt);
    resolved
        .negative
        .clone_from(&normalized.resolved_prompts().negative_prompt);
    resolved.settings = ResolvedSettings::from_request(&request);
    if request.characters.is_none() {
        resolved.characters.clear();
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
    sync_inputs(&mut resolved.inputs, &request);
    freeze_extra_noise_seed(&mut resolved.inputs, &prepared)?;
    // Persist only SDK parameters and immutable asset IDs, never copied image payloads.
    request.operation = GenerationInput::TextToImage;
    request.references = None;
    Ok(FrozenSubmission::Generation {
        seed: request.core.seed,
        resolved: Box::new(resolved),
        request: Box::new(request),
        diagnostics,
    })
}

fn adjustments(values: &[novelai_bridge::ValidationAdjustment]) -> Vec<ParameterDiagnostic> {
    values
        .iter()
        .map(|value| ParameterDiagnostic {
            field: value.field.to_string(),
            change: format!("已从 {} 调整为 {}。", value.from, value.to),
        })
        .collect()
}

fn freeze_extra_noise_seed(
    inputs: &mut CreationInputs,
    prepared: &novelai_bridge::PreparedGeneration,
) -> Result<(), JobError> {
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
    let encoded = prepared.encode(GenerationDelivery::Images)?;
    let body: serde_json::Value = serde_json::from_slice(&encoded).map_err(|error| {
        crate::persistence::PersistenceError::failure("read the SDK effective noise seed", error)
    })?;
    let parameters = if inpainting {
        &body["parameters"]["img2img"]
    } else {
        &body["parameters"]
    };
    *slot = Some(
        parameters["extra_noise_seed"]
            .as_i64()
            .ok_or_else(|| JobError::Invalid("SDK 准备结果缺少有效噪声种子。".to_owned()))?,
    );
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
        _ => return Err(JobError::Invalid("该操作不是图像生成。".to_owned())),
    };
    let references = &inputs.references;
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
        .filter(|item| item.enabled)
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
