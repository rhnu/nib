//! Local quote projection from a resolved resource snapshot and validated SDK preparation.

use novelai_bridge::AnlasPricingContext;

use super::{QuoteBasis, prepare_generation};
use crate::{
    api::UserMessage,
    jobs::{
        GenerationQuote, JobError, JobQueue, OperationKind, ParameterDiagnostic, TokenFieldUsage,
    },
    prompt::ResolvedDraft,
    session::{CreationOperation, Draft},
};

impl JobQueue {
    pub(in crate::jobs) fn quote_draft(&self, draft: &Draft) -> Result<GenerationQuote, JobError> {
        match &draft.inputs.operation {
            CreationOperation::TextToImage
            | CreationOperation::ImageToImage { .. }
            | CreationOperation::Inpainting { .. } => {
                let resolved = self.resolve_generation(draft)?;
                self.quote_generation_resolved(resolved)
            },
            _ => {
                let (submission, basis) = self.prepare_submission(draft)?;
                self.quote_prepared(
                    1,
                    submission.operation(),
                    None,
                    submission.diagnostics().to_vec(),
                    basis,
                )
            },
        }
    }

    pub(in crate::jobs) fn quote_generation_resolved(
        &self,
        resolved: ResolvedDraft,
    ) -> Result<GenerationQuote, JobError> {
        let request_count = resolved.inputs.request_count;
        let preparation = prepare_generation(resolved, self.assets.as_ref())?;
        self.quote_prepared(
            request_count,
            OperationKind::Generation,
            Some(preparation.resolved),
            preparation.diagnostics,
            QuoteBasis::Generation(Box::new(preparation.prepared)),
        )
    }

    fn quote_prepared(
        &self,
        request_count: u32,
        operation: OperationKind,
        resolved: Option<ResolvedDraft>,
        diagnostics: Vec<ParameterDiagnostic>,
        basis: QuoteBasis,
    ) -> Result<GenerationQuote, JobError> {
        let account = self.clients.account_sample();
        let context = account
            .as_ref()
            .map_or_else(AnlasPricingContext::default, |sample| {
                AnlasPricingContext::from(&sample.subscription)
            });
        let mut geometry = None;
        let mut sample_limit = None;
        let (estimated_anlas, too_expensive, tokens) = match basis {
            QuoteBasis::Generation(prepared) => {
                let plan = prepared.normalized();
                geometry = Some(*plan.geometry());
                sample_limit = Some(
                    plan.request()
                        .descriptor()
                        .sample_limit(plan.geometry().pricing_size),
                );
                let estimate =
                    novelai_bridge::estimate_anlas_cost(plan.anlas_estimate_input(context));
                let usage = plan
                    .count_tokens(&self.tokenizers)
                    .map_err(novelai_bridge::BridgeError::from)?;
                let tokens = token_usage_fields(usage);
                (Some(estimate.total), estimate.is_too_expensive(), tokens)
            },
            QuoteBasis::Director(prepared) => (
                Some(prepared.estimate_anlas_cost(context)),
                false,
                Vec::new(),
            ),
            QuoteBasis::EncodeVibe(model) => (
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
            QuoteBasis::Upscale(cost) => (cost, false, Vec::new()),
        };
        if !(1..=8).contains(&request_count) {
            return Err(JobError::Invalid(UserMessage::RequestCountRange));
        }
        let total_samples = resolved.as_ref().map_or(request_count, |resolved| {
            resolved.settings.n_samples * request_count
        });
        let per_request_estimated_anlas = estimated_anlas;
        let estimated_anlas = estimated_anlas.map(|cost| cost.saturating_mul(request_count));
        let account_sampled_at = account.as_ref().map(|sample| sample.sampled_at);
        Ok(GenerationQuote {
            request_count,
            total_samples,
            sample_limit,
            per_request_estimated_anlas,
            operation,
            resolved,
            estimated_anlas,
            geometry,
            account_specific: account.is_some(),
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
