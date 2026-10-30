import { t, useTranslation } from "@/shared/i18n";
import { useEffect, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import type { Draft, ModelCapabilities, Resource, ResolvedDraft } from "@/bindings/workbench";
import type { ParameterDiagnostic, TokenFieldUsage } from "@/bindings/generation";
import { ScanText, Settings2, X } from "lucide-react";
import { IconButton, Modal } from "@/shared/ui";
import { CompositionEditor } from "@/features/prompt/composition-editor";
import { SettingsEditor, focusSetting } from "@/features/prompt/settings-editor";
import { diagnosticSetting } from "@/features/prompt/settings";
import { ResolutionInspector } from "@/features/prompt/resolution-inspector";
import { promptApi } from "@/features/prompt/api";
import { TokenUsageIndicator } from "@/features/prompt/token-usage-indicator";
import { promptTokenUsage } from "@/features/prompt/token-usage";
import type { InsertTarget } from "@/features/library/resource-library";

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
  openLibrary,
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
  openLibrary: (target: InsertTarget) => void;
  edit: (draft: Draft) => void;
  setError: (message: unknown) => void;
  onFocusField?: (field: string) => void;
}) {
  useTranslation();

  const [inspector, setInspector] = useState(false);
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
    <section className="prompt-workspace">
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
        value={draft.composition}
        resources={resources}
        model={capabilities?.model ?? resolved?.settings.model ?? draft.settings.model ?? undefined}
        onChange={(composition) => edit({ ...draft, composition })}
        addChunk={openLibrary}
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
                  className="prompt-options-positioner"
                >
                  <Popover.Popup className="prompt-options-popup" initialFocus={false}>
                    <header>
                      <Popover.Title>{t("workbench.promptSettings")}</Popover.Title>
                      <Popover.Close
                        className="icon-button"
                        aria-label={t("workbench.closePromptSettings")}
                      >
                        <X size={14} aria-hidden />
                      </Popover.Close>
                    </header>
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
              className={`resolution-trigger ${resolveError || issueCount ? "danger" : ""}`}
              onClick={() => setInspector(true)}
            >
              <ScanText size={15} />
              {(resolveError || issueCount > 0) && (
                <span className="resolution-count">{resolveError ? "!" : issueCount}</span>
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
        <output className="inline-warning">{t("workbench.customNegativeUnsupported")}</output>
      )}
      {resolveError && (
        <p className="inline-warning" role="alert">
          {resolveError}
        </p>
      )}
      <Modal
        open={inspector}
        onClose={() => setInspector(false)}
        title={t("workbench.resolutionSources")}
        wide
      >
        <ResolutionInspector
          resolved={resolved}
          pending={resolving}
          error={resolveError}
          draft={draft}
          resources={resources}
          tokenModel={capabilities?.model}
          diagnostics={diagnostics}
          onFocusField={(field) => {
            setInspector(false);
            requestAnimationFrame(() => (onFocusField ?? focusSetting)(field));
          }}
        />
      </Modal>
    </section>
  );
}
