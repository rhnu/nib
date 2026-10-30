//! Locale-independent, parameterized messages retained and displayed across IPC.

/// Application messages retain semantic parameters; SDK and platform diagnostics retain detail.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum UserMessage {
    External {
        detail: String,
    },
    Messages {
        messages: Vec<Self>,
    },
    Validation {
        field: String,
        message: Box<Self>,
    },
    NotFound {
        entity: String,
        id: String,
    },
    Conflict {
        entity: String,
        id: String,
    },
    UnsupportedSchema {
        found: String,
    },
    StorageFailure {
        operation: String,
        detail: String,
    },
    StorageLocked,
    InvalidApiKey,
    CredentialUnavailable,
    InputMedia {
        message: Box<Self>,
    },
    MediaUnavailable {
        id: String,
    },
    MediaKindMismatch {
        id: String,
        expected: crate::media::AssetKind,
    },
    VibeDocumentContentMissing {
        id: String,
        entry_index: usize,
        content: String,
    },
    MissingResource {
        id: String,
    },
    ResourceTypeMismatch {
        id: String,
        expected: crate::library::ResourceKind,
    },
    StaleNodeOverride {
        id: String,
    },
    StaleOutputOverride {
        id: String,
    },
    NumericAdjusted {
        from: String,
        to: String,
    },
    ModelFallback {
        model: String,
    },
    ParameterConflict {
        retained_field: String,
    },
    CharacterLimit {
        limit: usize,
    },
    ProviderHttpFailure {
        status: u16,
    },
    ProviderTransportFailure,
    ProviderStreamFailure,
    AppStoppedBeforeCompletion,
    MissingCredentials,
    UnresolvedResources,
    QueueUnavailable,
    WorkerInterrupted,
    OperationIncomplete,
    AccountHasPendingJobs,
    AccountNameRequired,
    ApiKeyRequired,
    RecentImageLimit,
    MigrationInProgress,
    RestartRequired,
    MigrationDatabaseUnavailable,
    MigrationMediaUnavailable,
    DataDirectoryUnavailable,
    AbsoluteDirectoryRequired,
    EmptyDirectoryRequired,
    DirectoryBelongsToOtherData,
    DirectoryOverlapsConfig,
    DirectoryContainsSource,
    MigrationTargetMismatch,
    MigrationUnsupportedFile,
    CopiedFileLengthMismatch,
    CopiedFileContentMismatch,
    NonUnicodeDirectory,
    RetryRequiresTerminalJob,
    RetryJobMissing,
    VibeJobMissing,
    ExecutionInterrupted,
    UnknownMediaKind,
    ResultPageLimit,
    JobPageLimit,
    InvalidResultCursor,
    ThumbnailSourceUnavailable,
    IncompleteMedia,
    InvalidMediaId,
    VibeModelUnknown,
    AccountNotFound,
    CharacterSourceMismatch,
    CharacterSourceIndexMismatch,
    RequestCountRange,
    UnsupportedImageSource,
    NoFinalImages,
    VibeIsNotImage,
    NoRestorableMetadata,
    RestoreKnownFieldsOnly,
    RestoreCharactersUnavailable,
    RestoreEmbeddedVibesSeparately,
    RestoreUnknownFields,
    RestoreLegacyUcUnknown,
    RestoreModelUnknown,
    RestoreSamplerUnknown,
    RestoreNoiseScheduleUnknown,
    RestoreLiteralPrompts,
    DirectorStateMissing,
    UnsupportedParameterRemoved,
    ParameterFallback,
    ParameterNormalized,
    MissingNoiseSeed,
    NotImageGeneration,
    DatabaseBusy,
    DatabaseIntegrityFailed,
    VibeContentSelectionRequired,
    ValueRequired,
    DuplicateNodeAcrossScopes,
    ExpandedRequiresText,
    DuplicateCharacter,
    DuplicateNodeAcrossTargets,
    DuplicateReference,
    DuplicatePreset,
    DuplicateOverride,
    DuplicateOutputOverride,
    DuplicateImage,
    DuplicateTool,
    CommandToolMismatch,
    SelectedToolMissing,
    PositiveFiniteRequired,
    DuplicateMaskSource,
    MaskSessionMissing,
    PositiveDimensionsRequired,
    HistoryCursorOutOfRange,
    AppliedRevisionOutOfRange,
    FiniteRequired,
    FiniteCoordinatesRequired,
    RevisionOverflow,
}

impl UserMessage {
    /// Keeps local SDK and platform diagnostics in their original language.
    pub fn external(detail: impl Into<String>) -> Self {
        Self::External {
            detail: detail.into(),
        }
    }
}

impl std::fmt::Display for UserMessage {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::External { detail } => formatter.write_str(detail),
            _ => write!(formatter, "{self:?}"),
        }
    }
}

/// Retains SDK/platform diagnostics and the complete source chain at the display boundary.
pub fn error_detail(error: &(dyn std::error::Error + 'static)) -> String {
    let mut detail = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        detail.push_str(": ");
        detail.push_str(&cause.to_string());
        source = cause.source();
    }
    detail
}

#[cfg(test)]
mod tests;
