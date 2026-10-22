import { Plus } from "lucide-react";
import type { Draft, ModelCapabilities, Resource, ResolvedDraft } from "../../bindings/workbench";
import type { GenerationQuote, ParameterDiagnostic } from "../../bindings/generation";
import { Field, HelpMarker, IconButton } from "../../shared/ui";
import { PresetEditor } from "../prompt/PresetEditor";
import { SettingsEditor } from "../prompt/SettingsEditor";
import { moveItem } from "../prompt/model";
import { ImageOperationPanel } from "./ImageOperationPanel";
import type { ImageOperationAction } from "./image-operation";
export function ContextRail({
  draft,
  resources,
  models,
  resolved,
  capabilities,
  diagnostics,
  errorFields,
  readCurrentDraft,
  edit,
  onAddPreset,
  setError,
  estimate,
  onRestore,
  onRequestOperation,
  onReturnToText,
  imageInputVersion,
  onEditMask,
}: {
  draft: Draft;
  resources: Map<string, Resource>;
  models: string[];
  resolved: ResolvedDraft | null;
  capabilities: ModelCapabilities | null;
  diagnostics: ParameterDiagnostic[];
  errorFields: string[];
  readCurrentDraft: () => Draft;
  edit: (draft: Draft) => void;
  onAddPreset: () => void;
  setError: (message: string) => void;
  estimate: GenerationQuote | null;
  onRestore: (draft: Draft) => void;
  onRequestOperation: (id: string, kind: ImageOperationAction) => void;
  onReturnToText: () => void;
  imageInputVersion: number;
  onEditMask: (assetId: string) => void;
}) {
  return (
    <div className="context-rail">
      {draft.inputs.operation.kind !== "upscale" && (
        <section className="preset-context">
          <header className="section-heading">
            <h2>
              配方<span className="count">{draft.presets.length}</span>
              <HelpMarker label="配方帮助">
                配方按顺序应用，随后追加当前提示词。修改链接内容只覆盖当前实例；可在操作菜单中排序或展开为独立配方。
              </HelpMarker>
            </h2>
            <IconButton label="添加 Preset" onClick={onAddPreset}>
              <Plus size={16} />
            </IconButton>
          </header>
          {draft.presets.map((instance, index) => (
            <PresetEditor
              key={instance.id}
              instance={instance}
              resources={resources}
              models={models}
              onChange={(value) => {
                const current = readCurrentDraft();
                if (current)
                  edit({
                    ...current,
                    presets: current.presets.map((item) =>
                      item.id === instance.id ? value : item,
                    ),
                  });
              }}
              onRemove={() =>
                edit({
                  ...draft,
                  presets: draft.presets.filter((item) => item.id !== instance.id),
                })
              }
              up={() => edit({ ...draft, presets: moveItem(draft.presets, index, -1) })}
              down={() => edit({ ...draft, presets: moveItem(draft.presets, index, 1) })}
              canUp={index > 0}
              canDown={index < draft.presets.length - 1}
              onError={setError}
            />
          ))}
        </section>
      )}
      <ImageOperationPanel
        draft={draft}
        capabilities={capabilities}
        estimate={estimate}
        models={models}
        readCurrentDraft={readCurrentDraft}
        edit={edit}
        onRestore={onRestore}
        onError={setError}
        onRequestOperation={onRequestOperation}
        onReturnToText={onReturnToText}
        diagnostics={diagnostics}
        errorFields={errorFields}
        inputVersion={imageInputVersion}
        onEditMask={onEditMask}
      />
      {draft.inputs.operation.kind !== "upscale" && (
        <>
          <section className="settings-context">
            <header className="section-heading">
              <h2>图像设置</h2>
            </header>
            <SettingsEditor
              fields="image"
              value={draft.settings}
              models={models}
              capabilities={capabilities}
              diagnostics={diagnostics}
              errorFields={errorFields}
              resolved={resolved?.settings}
              onChange={(settings) => edit({ ...draft, settings })}
            />
          </section>
          <section className="settings-context">
            <header className="section-heading">
              <h2>
                参数
                <HelpMarker label="参数继承帮助">
                  留空继承配方或 SDK 默认值。输入框显示当前生效值，可在解析面板查看具体来源。
                </HelpMarker>
              </h2>
            </header>
            <SettingsEditor
              fields="parameters"
              value={draft.settings}
              models={models}
              capabilities={capabilities}
              diagnostics={diagnostics}
              errorFields={errorFields}
              resolved={resolved?.settings}
              onChange={(settings) => edit({ ...draft, settings })}
              advancedContent={
                <div data-setting-field="policy">
                  <Field label="参数校验策略">
                    <select
                      value={draft.inputs.policy}
                      onChange={(event) =>
                        edit({
                          ...draft,
                          inputs: {
                            ...draft.inputs,
                            policy: event.target.value === "reject" ? "reject" : "normalize",
                          },
                        })
                      }
                    >
                      <option value="normalize">自动调整并显示诊断</option>
                      <option value="reject">严格拒绝需要调整的参数</option>
                    </select>
                  </Field>
                </div>
              }
            />
          </section>
        </>
      )}
    </div>
  );
}
