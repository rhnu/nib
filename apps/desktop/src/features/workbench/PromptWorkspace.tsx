import { useState } from "react";
import type { Draft, ModelCapabilities, Resource, ResolvedDraft } from "../../bindings/workbench";
import type { ParameterDiagnostic, TokenFieldUsage } from "../../bindings/generation";
import { ScanText } from "lucide-react";
import { HelpMarker, IconButton, Modal } from "../../shared/ui";
import { CompositionEditor } from "../prompt/CompositionEditor";
import { SettingsEditor, focusSetting } from "../prompt/SettingsEditor";
import { ResolutionInspector } from "../prompt/ResolutionInspector";
import { promptApi } from "../prompt/api";
import { errorMessage } from "../../shared/host/error";
import { TokenUsageSummary } from "../generation/TokenUsageSummary";
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
}) {
  const [inspector, setInspector] = useState(false);
  const issueCount = resolved?.issues.length ?? 0;
  return (
    <section className="prompt-workspace">
      <SettingsEditor
        fields="model"
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
        models={models}
        model={resolved?.settings.model ?? draft.settings.model ?? undefined}
        onChange={(composition) => edit({ ...draft, composition })}
        addChunk={openLibrary}
        toolbarActions={
          <>
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
      <SettingsEditor
        fields="prompt"
        value={draft.settings}
        models={models}
        capabilities={capabilities}
        diagnostics={diagnostics}
        errorFields={errorFields}
        resolved={resolved?.settings}
        onChange={(settings) => edit({ ...draft, settings })}
      />
      <TokenUsageSummary tokens={tokens} />
      {capabilities?.customNegativePrompts === false && Boolean(resolved?.negative.trim()) && (
        <output className="inline-warning">
          此模型不接受自定义负面提示；编辑内容已保留，实际处理结果见 SDK 诊断。
        </output>
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
          diagnostics={diagnostics}
          onFocusField={(field) => {
            setInspector(false);
            requestAnimationFrame(() => focusSetting(field));
          }}
        />
      </Modal>
    </section>
  );
}
