import { IconButton, Modal, Row } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";
import { useEffect, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import type { Draft, ModelCapabilities, Resource, ResolvedDraft } from "@/bindings/workbench";
import type { ParameterDiagnostic, TokenFieldUsage } from "@/bindings/generation";
import { ScanText, Settings2, ListChecks, X } from "lucide-react";

import { CompositionEditor } from "@/features/prompt/composition-editor";
import { SettingsEditor, focusSetting } from "@/features/prompt/settings-editor";
import { diagnosticSetting } from "@/features/prompt/settings";
import { ResolutionInspector } from "@/features/prompt/resolution-inspector";
import { promptApi } from "@/features/prompt/api";
import { TokenUsageIndicator } from "@/features/prompt/token-usage-indicator";
import { promptTokenUsage } from "@/features/prompt/token-usage";

export function PromptWorkspace({
  draft,
  resources,
  resolved,
  resolving,
  resolveError,
  models,
  capabilities,
  diagnostics,
  tokens,
  tokenStatus,
  tokensPending,
  errorFields,
  readCurrentDraft,
  edit,
  setError,
  onFocusField,
}: {
  draft: Draft;
  resources: Map<string, Resource>;
  resolved: ResolvedDraft | null;
  resolving: boolean;
  resolveError: string;
  models: string[];
  capabilities: ModelCapabilities | null;
  diagnostics: ParameterDiagnostic[];
  tokens: TokenFieldUsage[];
  tokenStatus?: string;
  tokensPending?: boolean;
  errorFields: string[];
  readCurrentDraft: () => Draft;
  edit: (draft: Draft) => void;
  setError: (message: unknown) => void;
  onFocusField?: (field: string) => void;
}) {
  useTranslation();

  const [inspector, setInspector] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const issueCount = resolved
    ? resolved.issues.length +
      resolved.promptAnalysis.reduce(
        (count, { document }) => count + document.sourceDiagnostics.length,
        0,
      )
    : 0;
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [dismissedIssue, setDismissedIssue] = useState<string | null>(null);
  const optionIssue = [...errorFields, ...diagnostics.map((item) => item.field)].find((field) =>
    ["quality", "ucPreset", "furryMode", "transparentBackground"].includes(
      diagnosticSetting(field) ?? "",
    ),
  );
  const diagnosticSignature = JSON.stringify([diagnostics, errorFields]);
  const showOptions =
    optionsOpen || (Boolean(optionIssue) && dismissedIssue !== diagnosticSignature);
  useEffect(() => {
    if (optionIssue && showOptions) {
      const frame = requestAnimationFrame(() => focusSetting(optionIssue));
      return () => cancelAnimationFrame(frame);
    }
  }, [optionIssue, diagnosticSignature, showOptions]);
  return (
    <section className="prompt-workspace min-w-0 p-[8px_12px_4px] [&_>_.composition]:mt-space-3 [padding:8px_12px_4px]">
      <SettingsEditor
        fields="modelOnly"
        value={draft.settings}
        models={models}
        capabilities={capabilities}
        diagnostics={diagnostics}
        errorFields={errorFields}
        resolved={resolved?.settings}
        onChange={(settings) => edit({ ...draft, settings })}
      />
      <CompositionEditor
        negativeSupported={capabilities?.customNegativePrompts}
        value={draft.composition}
        resources={resources}
        model={capabilities?.model ?? resolved?.settings.model ?? draft.settings.model ?? undefined}
        onChange={(composition) => edit({ ...readCurrentDraft(), composition })}
        toolbarActions={
          <>
            <Popover.Root
              open={showOptions}
              onOpenChange={(open) => {
                setOptionsOpen(open);
                if (!open) setDismissedIssue(diagnosticSignature);
              }}
            >
              <Popover.Trigger
                render={<IconButton label={t("workbench.promptSettings")} />}
                className="icon-button"
                aria-label={t("workbench.promptSettings")}
                title={t("workbench.promptSettings")}
                data-prompt-options-trigger
              >
                <Settings2 size={15} aria-hidden />
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner
                  side="bottom"
                  align="end"
                  sideOffset={6}
                  className="prompt-options-positioner z-[65]"
                >
                  <Popover.Popup
                    className="prompt-options-popup [&_>_header]:flex [&_>_header]:items-center [&_>_header]:justify-between [&_>_header]:gap-space-3 [&_>_header]:mb-space-2 [&_h2]:text-body w-[min(340px,_calc(100vw_-_24px))] [padding:10px_12px_12px] border border-line rounded-overlay bg-raised text-foreground shadow-[var(--shadow)]"
                    initialFocus={false}
                  >
                    <Row gap={0} as="header">
                      <Popover.Title>{t("workbench.promptSettings")}</Popover.Title>
                      <Popover.Close
                        render={<IconButton label={t("workbench.closePromptSettings")} />}
                        className="icon-button"
                        aria-label={t("workbench.closePromptSettings")}
                      >
                        <X size={14} aria-hidden />
                      </Popover.Close>
                    </Row>
                    <SettingsEditor
                      fields="promptOptions"
                      value={draft.settings}
                      models={models}
                      capabilities={capabilities}
                      diagnostics={diagnostics}
                      errorFields={errorFields}
                      resolved={resolved?.settings}
                      onChange={(settings) => edit({ ...draft, settings })}
                    />
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
            <IconButton
              label={
                resolveError
                  ? t("workbench.resolutionFailedDetails")
                  : issueCount
                    ? t("workbench.viewResolutionIssues", { value0: issueCount })
                    : t("workbench.viewResolutionSources")
              }
              className={`resolution-trigger relative ${resolveError || issueCount ? "danger text-danger" : ""}`}
              onClick={() => setInspector(true)}
            >
              <ScanText size={15} />
              {(resolveError || issueCount > 0) && (
                <span className="resolution-count absolute top-[-2px] right-[-2px] min-w-[13px] py-0 px-[2px] rounded-control bg-danger text-panel text-[9px] leading-[13px]">
                  {resolveError ? "!" : issueCount}
                </span>
              )}
            </IconButton>
            <TokenUsageIndicator
              usage={promptTokenUsage(tokens)}
              label={t("generation.effectivePromptTokens")}
              status={tokenStatus}
              pending={tokensPending}
            />
          </>
        }
        expandChunk={async (node) => {
          try {
            return await promptApi.expandChunk(node);
          } catch (cause) {
            setError(cause);
            return node;
          }
        }}
      />
      {capabilities?.customNegativePrompts === false && Boolean(resolved?.negative.trim()) && (
        <output className="inline-warning text-danger text-label leading-[1.7]">
          {t("workbench.customNegativeUnsupported")}
        </output>
      )}
      {resolveError && (
        <p className="inline-warning text-danger text-label leading-[1.7]" role="alert">
          {resolveError}
        </p>
      )}
      <Modal
        open={inspector}
        onClose={() => {
          setInspector(false);
          setDiagnosticsOpen(false);
        }}
        title={t("workbench.resolutionSources")}
        wide
        className="resolution-modal [&_.modal-header]:shrink-0 [&_.modal-header]:py-space-4 [&_.modal-header]:px-space-5 [&_.modal-header_h2]:flex-1 [&_.resolution-diagnostics-toggle]:w-auto [&_.resolution-diagnostics-toggle]:gap-space-1 [&_.resolution-diagnostics-toggle]:px-space-2"
        actions={
          diagnostics.length > 0 && (
            <IconButton
              className="resolution-diagnostics-toggle [&[aria-expanded=true]]:text-accent [&[aria-expanded=true]]:bg-accent-soft"
              label={t("generation.sdkAdjustmentCount", { count: diagnostics.length })}
              aria-expanded={diagnosticsOpen}
              aria-controls="resolution-diagnostics"
              onClick={() => setDiagnosticsOpen((open) => !open)}
            >
              <ListChecks size={16} aria-hidden />
              <span>{diagnostics.length}</span>
            </IconButton>
          )
        }
      >
        <ResolutionInspector
          resolved={resolved}
          pending={resolving}
          error={resolveError}
          draft={draft}
          resources={resources}
          tokenModel={capabilities?.model}
          diagnostics={diagnostics}
          diagnosticsOpen={diagnosticsOpen}
          onFocusField={(field) => {
            setInspector(false);
            setDiagnosticsOpen(false);
            requestAnimationFrame(() => (onFocusField ?? focusSetting)(field));
          }}
        />
      </Modal>
    </section>
  );
}
