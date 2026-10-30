import { useEffect, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import type { Draft, ModelCapabilities, Resource, ResolvedDraft } from "../../bindings/workbench";
import type { ParameterDiagnostic, TokenFieldUsage } from "../../bindings/generation";
import { ScanText, Settings2, X } from "lucide-react";
import { HelpMarker, IconButton, Modal } from "../../shared/ui";
import { CompositionEditor } from "../prompt/CompositionEditor";
import { SettingsEditor, focusSetting } from "../prompt/SettingsEditor";
import { diagnosticSetting } from "../prompt/settings";
import { ResolutionInspector } from "../prompt/ResolutionInspector";
import { promptApi } from "../prompt/api";
import { errorMessage } from "../../shared/host/error";
import { TokenUsageSummary } from "../generation/submission/TokenUsageSummary";
import type { InsertTarget } from "../library/ResourceLibrary";
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
  errorFields: string[];
  openLibrary: (target: InsertTarget) => void;
  edit: (draft: Draft) => void;
  setError: (message: string) => void;
  onFocusField?: (field: string) => void;
}) {
  const [inspector, setInspector] = useState(false);
  const issueCount = resolved?.issues.length ?? 0;
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
                aria-label="提示词设置"
                title="提示词设置"
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
                      <Popover.Title>提示词设置</Popover.Title>
                      <Popover.Close className="icon-button" aria-label="关闭提示词设置">
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
                  ? "解析失败，查看详情"
                  : issueCount
                    ? `查看 ${issueCount} 项解析问题`
                    : "查看解析与来源"
              }
              className={`resolution-trigger ${resolveError || issueCount ? "danger" : ""}`}
              onClick={() => setInspector(true)}
            >
              <ScanText size={15} />
              {(resolveError || issueCount > 0) && (
                <span className="resolution-count">{resolveError ? "!" : issueCount}</span>
              )}
            </IconButton>
            <HelpMarker label="提示词帮助">
              添加文本或链接
              Chunk，用片段菜单调整顺序、撤销覆盖或展开为独立文本。编辑链接只影响当前实例。
            </HelpMarker>
          </>
        }
        expandChunk={async (node) => {
          try {
            return await promptApi.expandChunk(node);
          } catch (cause) {
            setError(errorMessage(cause));
            return node;
          }
        }}
      />
      <TokenUsageSummary tokens={tokens} />
      {capabilities?.customNegativePrompts === false && Boolean(resolved?.negative.trim()) && (
        <output className="inline-warning">此模型不接受自定义负面提示，已保留编辑内容。</output>
      )}
      {resolveError && (
        <p className="inline-warning" role="alert">
          {resolveError}
        </p>
      )}
      <Modal open={inspector} onClose={() => setInspector(false)} title="解析与来源" wide>
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
