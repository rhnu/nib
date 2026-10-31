//! Generate and verify TypeScript bindings for the desktop application.

use std::{fs, io::ErrorKind, path::Path};

use anyhow::{Context, Result, bail};
use nib_app::{
    api::{
        ApiError, AppInfo, CharacterPositionOptions, DraftAnalysis, ErrorCode, GenerationRanges,
        ModelCapabilities, NumericRange, PreciseReferenceOptions, ReferenceStatus, SizePreset,
        UserMessage, VibeReferenceOptions, WorkspaceSnapshot,
    },
    jobs::{
        FrozenSubmission, GenerationBatch, GenerationQuote, JobFeedback, JobObservation, JobPage,
        JobQuery, JobRecord, JobStatus, JobSummary, OperationKind, OperationSummary,
        ParameterDiagnostic, RequestSettlement, TokenFieldUsage, VibeEncodingOutcome,
    },
    library::{ResourceKind, ResourceQuery, ResourceSummary},
    media::{
        AssetKind, AssetSource, GenerationResult, ImageMetadataReport, ImageMetadataStatus,
        KnownCharacterMetadata, KnownImageMetadata, MediaAsset, MetadataRestore, PngTextInspection,
        ResultImageSource, ResultPage, ResultQuery, ResultSummary, VibeAssetInspection,
        VibeCacheSummary, VibeDocumentEntry, VibeDocumentInspection, VibeSourceDocument,
    },
    prompt::{
        CharacterComposition, CharacterOutputOverride, Composition, GenerationSettings,
        InputProvenance, InstanceOverride, PreciseReferenceOverride, PresetBinding, PresetInstance,
        PresetOutputOverrides, PromptNode, PromptScope, PromptSourceLocation, ResolutionIssue,
        ResolutionIssueKind, ResolvedCharacter, ResolvedDraft, ResolvedFragment,
        ResolvedPromptAnalysis, ResolvedSettings, Resource, ResourceContent, SettingSource,
        SettingsProvenance, TokenInspection, ValidationError, VibeReferenceOverride,
    },
    session::{
        ActivePage, CreationInputs, CreationOperation, DirectorToolKind, DirectorToolState,
        DirectorWorkspace, Draft, DraftSaveReceipt, ImageOperationKind, ImageOperationOptions,
        MaskCommand, MaskEditorState, MaskPoint, MaskSession, PngTextEditorState, PngTextSession,
        PngTextValue, PreciseReferenceInput, ReferenceInputs, VibeEncodingInput,
        VibeEncodingOptions, VibeInput, VibeReferenceInput,
    },
    settings::{
        AccountSnapshot, AccountStatus, AccountSummary, AllowanceSummary, ApplicationPreferences,
        ApplicationSettingsSnapshot, CredentialProfile, ExecutionPreferences, ImageRequestEncoding,
        Language, StorageLocations, Theme,
    },
};
use ts_rs::{Config, TS};

/// Generate and verify the same content independently of the working directory.
pub(super) fn run(check: bool) -> Result<()> {
    let workspace = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .context("xtask must live directly inside the workspace root")?;
    let app_info = app_info_types();

    let config = Config::new();
    let declarations = [
        ResourceKind::decl(&config),
        ResourceSummary::decl(&config),
        ResourceQuery::decl(&config),
        GenerationSettings::decl(&config),
        CharacterComposition::decl(&config),
        CreationInputs::decl(&config),
        CreationOperation::decl(&config),
        ImageOperationKind::decl(&config),
        ImageOperationOptions::decl(&config),
        MaskEditorState::decl(&config),
        MaskSession::decl(&config),
        MaskCommand::decl(&config),
        MaskPoint::decl(&config),
        ReferenceInputs::decl(&config),
        PreciseReferenceInput::decl(&config),
        VibeReferenceInput::decl(&config),
        VibeInput::decl(&config),
        VibeEncodingInput::decl(&config),
        VibeEncodingOptions::decl(&config),
        PresetOutputOverrides::decl(&config),
        CharacterOutputOverride::decl(&config),
        PreciseReferenceOverride::decl(&config),
        VibeReferenceOverride::decl(&config),
        PromptNode::decl(&config),
        Composition::decl(&config),
        Resource::decl(&config),
        ResourceContent::decl(&config),
        InstanceOverride::decl(&config),
        PresetBinding::decl(&config),
        PresetInstance::decl(&config),
        Draft::decl(&config),
        DraftSaveReceipt::decl(&config),
        DraftAnalysis::decl(&config),
        ActivePage::decl(&config),
        DirectorToolKind::decl(&config),
        DirectorToolState::decl(&config),
        DirectorWorkspace::decl(&config),
        PngTextEditorState::decl(&config),
        PngTextSession::decl(&config),
        PngTextValue::decl(&config),
        ValidationError::decl(&config),
        PromptScope::decl(&config),
        ResolutionIssueKind::decl(&config),
        ResolutionIssue::decl(&config),
        ResolvedFragment::decl(&config),
        ResolvedCharacter::decl(&config),
        InputProvenance::decl(&config),
        ResolvedSettings::decl(&config),
        SettingSource::decl(&config),
        SettingsProvenance::decl(&config),
        ResolvedDraft::decl(&config),
        PromptSourceLocation::decl(&config),
        ResolvedPromptAnalysis::decl(&config),
        WorkspaceSnapshot::decl(&config),
        ErrorCode::decl(&config),
        UserMessage::decl(&config),
        ApiError::decl(&config),
        ReferenceStatus::decl(&config),
        NumericRange::decl(&config),
        CharacterPositionOptions::decl(&config),
        PreciseReferenceOptions::decl(&config),
        VibeReferenceOptions::decl(&config),
        GenerationRanges::decl(&config),
        ModelCapabilities::decl(&config),
        SizePreset::decl(&config),
        TokenInspection::decl(&config),
    ];
    let workbench = format!(
        "// Generated by `cargo xtask types`. Do not edit.\n\nimport type {{ AppInfo }} from \"./app-info\";\nimport type {{ GenerationQuote }} from \"./generation\";\nimport type {{ AssetKind }} from \"./media\";\nimport type {{ PromptDocument }} from \"./prompt\";\n\n{}\n\n{}\n",
        export_declarations(declarations),
        sdk_prompt_types(),
    );
    let generation = generation_types(&config);
    let media = media_types(&config);
    let settings = settings_types(&config);
    for (name, content) in [
        ("app-info.ts", app_info),
        ("workbench.ts", workbench),
        ("generation.ts", generation),
        ("media.ts", media),
        ("settings.ts", settings),
        ("prompt.ts", prompt_types(&config)),
        ("lexicon.ts", lexicon_types(&config)),
        ("downloads.ts", download_types(&config)),
    ] {
        write_binding(
            &workspace.join("apps/desktop/src/bindings").join(name),
            &content,
            check,
        )?;
    }
    Ok(())
}

fn app_info_types() -> String {
    format!(
        "// Generated by `cargo xtask types`. Do not edit.\n\nexport {}\n",
        AppInfo::decl(&Config::new())
    )
}

fn download_types(config: &Config) -> String {
    use nib_app::downloads::{
        DownloadProgress, DownloadState, DownloadStatus, DownloadableResourceStatus,
        ResourceComponentStatus,
    };
    format!(
        "// Generated by `cargo xtask types`. Do not edit.\n\n{}\n",
        export_declarations([
            DownloadState::decl(config),
            DownloadProgress::decl(config),
            ResourceComponentStatus::decl(config),
            DownloadableResourceStatus::decl(config),
            DownloadStatus::decl(config),
        ])
    )
}

fn lexicon_types(config: &Config) -> String {
    use nib_app::lexicon::{
        LexiconKind, LexiconMatch, LexiconMatchReason, LexiconQuery, LexiconSearchResult,
        LexiconStatus, LexiconTerm,
    };
    format!(
        "// Generated by `cargo xtask types`. Do not edit.\n\n{}\n",
        export_declarations([
            LexiconKind::decl(config),
            LexiconTerm::decl(config),
            LexiconMatchReason::decl(config),
            LexiconMatch::decl(config),
            LexiconQuery::decl(config),
            LexiconSearchResult::decl(config),
            LexiconStatus::decl(config),
        ])
    )
}

fn prompt_types(config: &Config) -> String {
    use nib_app::prompt::nib_prompt::{
        LexiconFormatTerm, PromptAnalysis, PromptContext, PromptDiagnostic, PromptDiagnosticCode,
        PromptDiagnosticSeverity, PromptDocument, PromptSemanticKind, PromptSemanticSpan,
        PromptSyntaxProfile, PromptToken, PromptTokenKind, PromptWeight, SourceDiagnostic,
        SourceDiagnosticCode, SourceSegment, TextRange,
    };
    format!(
        "// Generated by `cargo xtask types`. Do not edit.\n\n{}\n",
        export_declarations([
            PromptSyntaxProfile::decl(config),
            PromptAnalysis::decl(config),
            PromptToken::decl(config),
            PromptTokenKind::decl(config),
            PromptSemanticSpan::decl(config),
            PromptSemanticKind::decl(config),
            PromptWeight::decl(config),
            PromptDiagnostic::decl(config),
            PromptDiagnosticCode::decl(config),
            PromptDiagnosticSeverity::decl(config),
            TextRange::decl(config),
            PromptContext::decl(config),
            SourceSegment::decl(config),
            SourceDiagnosticCode::decl(config),
            SourceDiagnostic::decl(config),
            PromptDocument::decl(config),
            LexiconFormatTerm::decl(config),
        ])
    )
}

fn settings_types(config: &Config) -> String {
    format!(
        "// Generated by `cargo xtask types`. Do not edit.\n\n{}\n",
        export_declarations([
            Language::decl(config),
            Theme::decl(config),
            ImageRequestEncoding::decl(config),
            ExecutionPreferences::decl(config),
            ApplicationPreferences::decl(config),
            StorageLocations::decl(config),
            ApplicationSettingsSnapshot::decl(config),
        ])
    )
}

/// The SDK owns these IPC values but does not derive TS. Keep its wire shape at this boundary.
fn sdk_prompt_types() -> &'static str {
    "export type FramingPolicy = \"content_only\" | \"model_input\";"
}

fn generation_types(config: &Config) -> String {
    format!(
        "// Generated by `cargo xtask types`. Do not edit.\n\nimport type {{ ResolvedDraft, DirectorToolKind, VibeEncodingInput, UserMessage }} from \"./workbench\";\nimport type {{ AssetKind, ResultImageSource }} from \"./media\";\nimport type {{ ExecutionPreferences }} from \"./settings\";\n\n{}\n",
        export_declarations([
            AccountStatus::decl(config),
            CredentialProfile::decl(config),
            AccountSnapshot::decl(config),
            AccountSummary::decl(config),
            AllowanceSummary::decl(config),
            FrozenSubmission::decl(config),
            JobStatus::decl(config),
            JobObservation::decl(config),
            RequestSettlement::decl(config),
            JobRecord::decl(config),
            OperationSummary::decl(config),
            JobSummary::decl(config),
            JobQuery::decl(config),
            JobPage::decl(config),
            ResultSummary::decl(config),
            ResultQuery::decl(config),
            ResultPage::decl(config),
            GenerationQuote::decl(config),
            GenerationBatch::decl(config),
            VibeEncodingOutcome::decl(config),
            OperationKind::decl(config),
            TokenFieldUsage::decl(config),
            ParameterDiagnostic::decl(config),
            JobFeedback::decl(config),
            GenerationResult::decl(config),
        ])
    )
}

fn media_types(config: &Config) -> String {
    format!(
        "// Generated by `cargo xtask types`. Do not edit.\n\nimport type {{ Draft, PngTextValue, VibeEncodingInput, UserMessage }} from \"./workbench\";\n\n{}\n",
        export_declarations([
            AssetKind::decl(config),
            ResultImageSource::decl(config),
            AssetSource::decl(config),
            MediaAsset::decl(config),
            ImageMetadataStatus::decl(config),
            KnownCharacterMetadata::decl(config),
            KnownImageMetadata::decl(config),
            ImageMetadataReport::decl(config),
            PngTextInspection::decl(config),
            MetadataRestore::decl(config),
            VibeDocumentInspection::decl(config),
            VibeDocumentEntry::decl(config),
            VibeCacheSummary::decl(config),
            VibeAssetInspection::decl(config),
            VibeSourceDocument::decl(config),
        ])
    )
}

fn export_declarations(declarations: impl IntoIterator<Item = String>) -> String {
    declarations
        .into_iter()
        .map(|declaration| {
            let declaration = declaration
                .lines()
                .map(str::trim_end)
                .collect::<Vec<_>>()
                .join("\n");
            format!("export {declaration}")
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn write_binding(output: &Path, content: &str, check: bool) -> Result<()> {
    if check {
        let existing = match fs::read_to_string(output) {
            Ok(existing) => existing,
            Err(error) if error.kind() == ErrorKind::NotFound => {
                bail!(
                    "{} is missing. Run `cargo xtask types` to generate it.",
                    output.display()
                );
            },
            Err(error) => {
                return Err(error).with_context(|| format!("read {}", output.display()));
            },
        };

        if existing != content {
            bail!(
                "{} is out of date. Run `cargo xtask types` to regenerate it.",
                output.display()
            );
        }

        println!("{} is up to date.", output.display());
        return Ok(());
    }

    let directory = output
        .parent()
        .context("the binding output must have a parent directory")?;
    fs::create_dir_all(directory).with_context(|| format!("create {}", directory.display()))?;
    fs::write(output, content).with_context(|| format!("write {}", output.display()))?;
    println!("Generated {}", output.display());
    Ok(())
}
