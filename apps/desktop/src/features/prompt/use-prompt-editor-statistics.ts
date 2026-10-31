import { useQuery } from "@tanstack/react-query";
import type { PromptDocument } from "@/bindings/prompt";
import { t, formatNumber } from "@/shared/i18n";
import { errorMessage } from "@/shared/host/error";
import { useDelayedPending } from "@/shared/query/use-delayed-pending";
import { promptApi } from "./api";
import type { PromptContext } from "./analysis-protocol";
import { promptDiagnostics } from "./editor-diagnostics";
import { usePromptAnalysis } from "./use-prompt-analysis";

/** Keep analysis and token counts tied to the exact source, model and syntax profile. */
export function usePromptEditorStatistics({
  value,
  model,
  context,
  analysisDocument,
  tokenUnavailableLabel,
}: {
  value: string;
  model?: string;
  context: PromptContext;
  analysisDocument?: PromptDocument;
  tokenUnavailableLabel: string;
}) {
  const liveAnalysis = usePromptAnalysis(value, model, context, {
    enabled: analysisDocument === undefined,
  });
  const analysis =
    analysisDocument === undefined
      ? liveAnalysis
      : {
          document: analysisDocument,
          pending: false,
          error: "",
          retry: liveAnalysis.retry,
        };
  const diagnostics = promptDiagnostics(analysis.document);
  const sourceInvalid = Boolean(analysis.document?.sourceDiagnostics.length);
  const tokenText = analysis.document?.text;
  const tokenReady = tokenText !== undefined && !sourceInvalid;
  const analysisContext = JSON.stringify([
    model,
    context,
    liveAnalysis.profile,
    analysisDocument !== undefined,
  ]);
  const countAvailable = Boolean(model) && !sourceInvalid && !analysis.error;
  const query = useQuery({
    queryKey: ["prompt-tokens", model, tokenText, "content_only", analysisContext],
    // Rust already removed source comments. The SDK receives native prompt text exactly once.
    queryFn: () => promptApi.inspectTokens(model!, tokenText!, "content_only"),
    enabled: Boolean(model) && tokenReady,
    placeholderData: (previous, previousQuery) =>
      countAvailable && previousQuery?.queryKey[4] === analysisContext ? previous : undefined,
    staleTime: Infinity,
    gcTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const count = countAvailable && !query.isError ? query.data?.count.used : undefined;
  const tokenError = tokenReady && query.error ? errorMessage(query.error) : "";
  const pending =
    analysis.pending ||
    (Boolean(model) &&
      tokenReady &&
      (query.isPending || query.isFetching || query.isPlaceholderData));
  const loadingIndicator = useDelayedPending(pending);
  const status = analysis.error
    ? t("prompt.analysisFailed", { value0: analysis.error })
    : sourceInvalid
      ? t("prompt.fixSourceBeforeCounting")
      : !model
        ? tokenUnavailableLabel
        : tokenError
          ? t("prompt.tokenCountFailed", { value0: tokenError })
          : count === undefined
            ? t("prompt.countingTokens")
            : `${t("prompt.tokenCount", { count, formattedCount: formatNumber(count) })}${loadingIndicator ? ` · ${t("prompt.updating")}` : ""}`;
  return {
    document: analysis.document,
    profile: liveAnalysis.profile,
    analysisContext,
    analysisPending: analysis.pending,
    analysisError: analysis.error,
    tokenError,
    diagnostics,
    pending,
    loadingIndicator,
    status,
    hasIssue: Boolean(analysis.error || tokenError || diagnostics.length),
    retryAnalysis: analysis.retry,
    retryCount: () => void query.refetch(),
  };
}

export type PromptEditorStatistics = ReturnType<typeof usePromptEditorStatistics>;
