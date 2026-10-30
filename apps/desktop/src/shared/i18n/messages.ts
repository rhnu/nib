import type { UserMessage } from "@/bindings/workbench";
import { t } from "./runtime";

class DeferredMessageValue {
  readonly format: () => string;

  constructor(format: () => string) {
    this.format = format;
  }
}

export type DeferredMessage = DeferredMessageValue;

/** Capture semantic feedback without fixing its display language at the time of the operation. */
export function deferMessage(format: () => string): DeferredMessage {
  return new DeferredMessageValue(format);
}

/** Keep Error/stack semantics while evaluating a local message in the current language. */
export class MessageError extends Error {
  private readonly deferred: DeferredMessage;

  constructor(message: DeferredMessage) {
    super();
    this.name = "MessageError";
    this.deferred = message;
  }

  override get message(): string {
    return this.deferred.format();
  }
}

function entityLabel(entity: string): string {
  switch (entity) {
    case "resource":
      return t("messages.entityResource");
    case "job":
      return t("messages.entityJob");
    case "media":
      return t("messages.entityMedia");
    case "result":
      return t("messages.entityResult");
    case "account":
      return t("messages.entityAccount");
    default:
      return entity;
  }
}

function mediaKindLabel(kind: string): string {
  switch (kind) {
    case "image":
      return t("messages.kindImage");
    case "vibe":
      return t("messages.kindVibe");
    case "vibeDocument":
      return t("messages.kindVibeDocument");
    default:
      return kind;
  }
}

/** Typed nib messages are localized; SDK and platform details remain intact. */
export function formatUserMessage(message: UserMessage): string {
  switch (message.kind) {
    case "external":
      return message.detail;
    case "messages":
      return message.messages.map(formatUserMessage).join("\n");
    case "validation":
      return t("messages.validation", {
        field: message.field,
        detail: formatUserMessage(message.message),
      });
    case "notFound":
      return t("messages.notFound", { ...message, entity: entityLabel(message.entity) });
    case "conflict":
      return t("messages.conflict", { ...message, entity: entityLabel(message.entity) });
    case "unsupportedSchema":
      return t("messages.unsupportedSchema", message);
    case "storageFailure":
      return t("messages.storageFailure", message);
    case "inputMedia":
      return t("messages.inputMedia", { detail: formatUserMessage(message.message) });
    case "mediaUnavailable":
      return t("messages.mediaUnavailable", message);
    case "mediaKindMismatch":
      return t("messages.mediaKindMismatch", {
        ...message,
        expected: mediaKindLabel(message.expected),
      });
    case "vibeDocumentContentMissing":
      return t("messages.vibeDocumentContentMissing", {
        ...message,
        entry: message.entryIndex + 1,
        content:
          message.content === "image"
            ? t("messages.contentImage")
            : message.content === "encoding cache"
              ? t("messages.contentEncoding")
              : message.content === "entry"
                ? t("messages.contentEntry")
                : message.content,
      });
    case "missingResource":
      return t("messages.missingResource", message);
    case "resourceTypeMismatch":
      return t("messages.resourceTypeMismatch", message);
    case "staleNodeOverride":
      return t("messages.staleNodeOverride", message);
    case "staleOutputOverride":
      return t("messages.staleOutputOverride", message);
    case "numericAdjusted":
      return t("messages.numericAdjusted", message);
    case "modelFallback":
      return t("messages.modelFallback", message);
    case "parameterConflict":
      return t("messages.parameterConflict", message);
    case "characterLimit":
      return t("messages.characterLimit", { ...message, count: message.limit });
    case "providerHttpFailure":
      return t("messages.providerHttpFailure", message);
    default:
      return t(staticMessages[message.kind]);
  }
}

const staticMessages = {
  storageLocked: "messages.storageLocked",
  invalidApiKey: "messages.invalidApiKey",
  credentialUnavailable: "messages.credentialUnavailable",
  providerTransportFailure: "messages.providerTransportFailure",
  providerStreamFailure: "messages.providerStreamFailure",
  appStoppedBeforeCompletion: "messages.appStoppedBeforeCompletion",
  missingCredentials: "messages.missingCredentials",
  unresolvedResources: "messages.unresolvedResources",
  invalidPromptSource: "messages.invalidPromptSource",
  queueUnavailable: "messages.queueUnavailable",
  workerInterrupted: "messages.workerInterrupted",
  operationIncomplete: "messages.operationIncomplete",
  accountHasPendingJobs: "messages.accountHasPendingJobs",
  accountNameRequired: "messages.accountNameRequired",
  apiKeyRequired: "messages.apiKeyRequired",
  recentImageLimit: "messages.recentImageLimit",
  migrationInProgress: "messages.migrationInProgress",
  restartRequired: "messages.restartRequired",
  migrationDatabaseUnavailable: "messages.migrationDatabaseUnavailable",
  migrationMediaUnavailable: "messages.migrationMediaUnavailable",
  dataDirectoryUnavailable: "messages.dataDirectoryUnavailable",
  absoluteDirectoryRequired: "messages.absoluteDirectoryRequired",
  emptyDirectoryRequired: "messages.emptyDirectoryRequired",
  directoryBelongsToOtherData: "messages.directoryBelongsToOtherData",
  directoryOverlapsConfig: "messages.directoryOverlapsConfig",
  directoryContainsSource: "messages.directoryContainsSource",
  migrationTargetMismatch: "messages.migrationTargetMismatch",
  migrationUnsupportedFile: "messages.migrationUnsupportedFile",
  copiedFileLengthMismatch: "messages.copiedFileLengthMismatch",
  copiedFileContentMismatch: "messages.copiedFileContentMismatch",
  nonUnicodeDirectory: "messages.nonUnicodeDirectory",
  retryRequiresTerminalJob: "messages.retryRequiresTerminalJob",
  retryJobMissing: "messages.retryJobMissing",
  vibeJobMissing: "messages.vibeJobMissing",
  executionInterrupted: "messages.executionInterrupted",
  unknownMediaKind: "messages.unknownMediaKind",
  resultPageLimit: "messages.resultPageLimit",
  jobPageLimit: "messages.jobPageLimit",
  invalidResultCursor: "messages.invalidResultCursor",
  thumbnailSourceUnavailable: "messages.thumbnailSourceUnavailable",
  incompleteMedia: "messages.incompleteMedia",
  invalidMediaId: "messages.invalidMediaId",
  vibeModelUnknown: "messages.vibeModelUnknown",
  accountNotFound: "messages.accountNotFound",
  characterSourceMismatch: "messages.characterSourceMismatch",
  characterSourceIndexMismatch: "messages.characterSourceIndexMismatch",
  requestCountRange: "messages.requestCountRange",
  unsupportedImageSource: "messages.unsupportedImageSource",
  noFinalImages: "messages.noFinalImages",
  vibeIsNotImage: "messages.vibeIsNotImage",
  noRestorableMetadata: "messages.noRestorableMetadata",
  restoreKnownFieldsOnly: "messages.restoreKnownFieldsOnly",
  restoreCharactersUnavailable: "messages.restoreCharactersUnavailable",
  restoreEmbeddedVibesSeparately: "messages.restoreEmbeddedVibesSeparately",
  restoreUnknownFields: "messages.restoreUnknownFields",
  restoreLegacyUcUnknown: "messages.restoreLegacyUcUnknown",
  restoreModelUnknown: "messages.restoreModelUnknown",
  restoreSamplerUnknown: "messages.restoreSamplerUnknown",
  restoreNoiseScheduleUnknown: "messages.restoreNoiseScheduleUnknown",
  restoreLiteralPrompts: "messages.restoreLiteralPrompts",
  directorStateMissing: "messages.directorStateMissing",
  unsupportedParameterRemoved: "messages.unsupportedParameterRemoved",
  parameterFallback: "messages.parameterFallback",
  parameterNormalized: "messages.parameterNormalized",
  missingNoiseSeed: "messages.missingNoiseSeed",
  notImageGeneration: "messages.notImageGeneration",
  databaseBusy: "messages.databaseBusy",
  databaseIntegrityFailed: "messages.databaseIntegrityFailed",
  vibeContentSelectionRequired: "messages.vibeContentSelectionRequired",
  valueRequired: "messages.valueRequired",
  duplicateNodeAcrossScopes: "messages.duplicateNodeAcrossScopes",
  expandedRequiresText: "messages.expandedRequiresText",
  duplicateCharacter: "messages.duplicateCharacter",
  duplicateNodeAcrossTargets: "messages.duplicateNodeAcrossTargets",
  duplicateReference: "messages.duplicateReference",
  duplicatePreset: "messages.duplicatePreset",
  duplicateOverride: "messages.duplicateOverride",
  duplicateOutputOverride: "messages.duplicateOutputOverride",
  duplicateImage: "messages.duplicateImage",
  duplicateTool: "messages.duplicateTool",
  commandToolMismatch: "messages.commandToolMismatch",
  selectedToolMissing: "messages.selectedToolMissing",
  positiveFiniteRequired: "messages.positiveFiniteRequired",
  duplicateMaskSource: "messages.duplicateMaskSource",
  maskSessionMissing: "messages.maskSessionMissing",
  positiveDimensionsRequired: "messages.positiveDimensionsRequired",
  historyCursorOutOfRange: "messages.historyCursorOutOfRange",
  appliedRevisionOutOfRange: "messages.appliedRevisionOutOfRange",
  finiteRequired: "messages.finiteRequired",
  finiteCoordinatesRequired: "messages.finiteCoordinatesRequired",
  revisionOverflow: "messages.revisionOverflow",
} as const;

/** Interpret errors at display time, preserving raw external details and nested application messages. */
export function errorMessage(error: unknown): string {
  if (error instanceof DeferredMessageValue) return error.format();
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    if ("kind" in error && typeof error.kind === "string" && messageKinds.has(error.kind))
      return formatUserMessage(error as UserMessage);
    if ("message" in error) return errorMessage(error.message);
  }
  return t("messages.operationFailed");
}

const messageKinds = new Set<string>([
  "external",
  "messages",
  "validation",
  "notFound",
  "conflict",
  "unsupportedSchema",
  "storageFailure",
  "storageLocked",
  "invalidApiKey",
  "credentialUnavailable",
  "inputMedia",
  "mediaUnavailable",
  "mediaKindMismatch",
  "vibeDocumentContentMissing",
  "missingResource",
  "resourceTypeMismatch",
  "staleNodeOverride",
  "staleOutputOverride",
  "numericAdjusted",
  "modelFallback",
  "parameterConflict",
  "characterLimit",
  "providerHttpFailure",
  "providerTransportFailure",
  "providerStreamFailure",
  "appStoppedBeforeCompletion",
  "missingCredentials",
  "unresolvedResources",
  "invalidPromptSource",
  "queueUnavailable",
  "workerInterrupted",
  "operationIncomplete",
  "accountHasPendingJobs",
  "accountNameRequired",
  "apiKeyRequired",
  "recentImageLimit",
  "migrationInProgress",
  "restartRequired",
  "migrationDatabaseUnavailable",
  "migrationMediaUnavailable",
  "dataDirectoryUnavailable",
  "absoluteDirectoryRequired",
  "emptyDirectoryRequired",
  "directoryBelongsToOtherData",
  "directoryOverlapsConfig",
  "directoryContainsSource",
  "migrationTargetMismatch",
  "migrationUnsupportedFile",
  "copiedFileLengthMismatch",
  "copiedFileContentMismatch",
  "nonUnicodeDirectory",
  "retryRequiresTerminalJob",
  "retryJobMissing",
  "vibeJobMissing",
  "executionInterrupted",
  "unknownMediaKind",
  "resultPageLimit",
  "jobPageLimit",
  "invalidResultCursor",
  "thumbnailSourceUnavailable",
  "incompleteMedia",
  "invalidMediaId",
  "vibeModelUnknown",
  "accountNotFound",
  "characterSourceMismatch",
  "characterSourceIndexMismatch",
  "requestCountRange",
  "unsupportedImageSource",
  "noFinalImages",
  "vibeIsNotImage",
  "noRestorableMetadata",
  "restoreKnownFieldsOnly",
  "restoreCharactersUnavailable",
  "restoreEmbeddedVibesSeparately",
  "restoreUnknownFields",
  "restoreLegacyUcUnknown",
  "restoreModelUnknown",
  "restoreSamplerUnknown",
  "restoreNoiseScheduleUnknown",
  "restoreLiteralPrompts",
  "directorStateMissing",
  "unsupportedParameterRemoved",
  "parameterFallback",
  "parameterNormalized",
  "missingNoiseSeed",
  "notImageGeneration",
  "databaseBusy",
  "databaseIntegrityFailed",
  "vibeContentSelectionRequired",
  "valueRequired",
  "duplicateNodeAcrossScopes",
  "expandedRequiresText",
  "duplicateCharacter",
  "duplicateNodeAcrossTargets",
  "duplicateReference",
  "duplicatePreset",
  "duplicateOverride",
  "duplicateOutputOverride",
  "duplicateImage",
  "duplicateTool",
  "commandToolMismatch",
  "selectedToolMissing",
  "positiveFiniteRequired",
  "duplicateMaskSource",
  "maskSessionMissing",
  "positiveDimensionsRequired",
  "historyCursorOutOfRange",
  "appliedRevisionOutOfRange",
  "finiteRequired",
  "finiteCoordinatesRequired",
  "revisionOverflow",
]);
