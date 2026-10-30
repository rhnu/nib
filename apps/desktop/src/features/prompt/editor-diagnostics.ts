import type { PromptDocument, SourceDiagnostic } from "@/bindings/prompt";
import { t } from "@/shared/i18n";

const sourceMessages = {
  unclosedBlockComment: () => t("prompt.unclosedBlockComment"),
  ambiguousCommentContext: () => t("prompt.ambiguousCommentContext"),
};

export function sourceDiagnosticMessage(diagnostic: SourceDiagnostic): string {
  return sourceMessages[diagnostic.code]();
}

/** Keep SDK diagnostics and nib source diagnostics separate at the parser boundary. */
export function promptDiagnostics(document: PromptDocument | null) {
  if (!document) return [];
  return [
    ...document.sourceDiagnostics.map((item) => ({
      ...item,
      severity: "error" as const,
      message: sourceDiagnosticMessage(item),
    })),
    ...document.analysis.diagnostics,
  ];
}
