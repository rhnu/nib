import { useEffect, useLayoutEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import type { Resource } from "../../bindings/workbench";
import { ActionsMenu, Button, Field, HelpMarker } from "../../shared/ui";
import { CompositionEditor } from "../prompt/CompositionEditor";
import { SettingsEditor } from "../prompt/SettingsEditor";
import { promptApi } from "../prompt/api";
import { errorMessage } from "../../shared/host/error";
import { useModelCapabilities } from "../model/useModelCapabilities";
import { PromptTextEditor } from "../prompt/PromptTextEditor";
import { CharacterListEditor, CharacterPositionPolicy } from "../characters";
import { PreciseReferenceEditor } from "../references";
import { VibeReferenceEditor } from "../vibes";
export function ResourceEditor({
  editor,
  dirty,
  busy,
  models,
  resources,
  change,
  leave,
  dismiss,
  remove,
  save,
  setError,
}: {
  editor: Resource;
  dirty: boolean;
  busy: boolean;
  models: string[];
  resources: Map<string, Resource>;
  change: (resource: Resource) => void;
  leave: (action: () => void) => void;
  dismiss: () => void;
  remove: () => void;
  save: () => Promise<void>;
  setError: (message: string) => void;
}) {
  const model = useModelCapabilities(
    editor.content.kind === "preset" ? (editor.content.defaults.model ?? undefined) : undefined,
    editor.content.kind === "preset" ? editor.content.defaults : null,
  );
  const latest = useRef({ editor, change, active: true });
  useLayoutEffect(() => {
    Object.assign(latest.current, { editor, change });
  }, [editor, change]);
  useEffect(() => {
    const current = latest.current;
    current.active = true;
    return () => {
      current.active = false;
    };
  }, []);
  const update = (apply: (resource: Resource) => Resource) => {
    const current = latest.current;
    if (!current.active || current.editor.id !== editor.id) return;
    const next = apply(current.editor);
    current.editor = next;
    current.change(next);
  };
  const updatePreset = (
    patch: Partial<Omit<Extract<Resource["content"], { kind: "preset" }>, "kind">>,
  ) =>
    update((current) =>
      current.content.kind === "preset"
        ? { ...current, content: { ...current.content, ...patch } }
        : current,
    );
  return (
    <section className="resource-editor">
      <header className="resource-editor-heading">
        <Button className="quiet" onClick={() => leave(dismiss)}>
          <ArrowLeft size={14} />
          列表
        </Button>
        <span className="tag">{editor.content.kind === "chunk" ? "Chunk" : "Preset"}</span>
        <span className="spacer" />
        {editor.revision > 0 && (
          <ActionsMenu
            label="资源管理"
            items={[{ label: "删除资源", danger: true, action: remove, disabled: busy }]}
          />
        )}
      </header>
      <fieldset disabled={busy}>
        <Field label="资源名称">
          <input
            value={editor.name}
            placeholder="为资源命名"
            onChange={(event) => update((current) => ({ ...current, name: event.target.value }))}
          />
        </Field>
        {editor.content.kind === "chunk" ? (
          <div className="resource-text">
            <PromptTextEditor
              label="提示词内容"
              value={editor.content.text}
              models={models}
              model={model.capabilities?.model}
              disabled={busy}
              placeholder="输入可复用的提示词…"
              onChange={(text) =>
                update((current) =>
                  current.content.kind === "chunk"
                    ? { ...current, content: { kind: "chunk", text } }
                    : current,
                )
              }
            />
          </div>
        ) : (
          <>
            <CompositionEditor
              key={editor.id}
              compact
              value={editor.content.composition}
              resources={resources}
              models={models}
              model={model.capabilities?.model}
              onChange={(composition) => updatePreset({ composition })}
              expandChunk={async (node) => {
                try {
                  return await promptApi.expandChunk(node);
                } catch (cause) {
                  setError(errorMessage(cause));
                  return node;
                }
              }}
            />
            <PreciseReferenceEditor
              value={editor.content.references.precise}
              capabilities={model.capabilities}
              contextKey={editor.id}
              onChange={(precise) => {
                const current = latest.current.editor.content;
                if (current.kind === "preset")
                  updatePreset({ references: { ...current.references, precise } });
              }}
            />
            <VibeReferenceEditor
              value={editor.content.references.vibes}
              normalizeValue={editor.content.references.normalizeVibeStrength}
              onNormalizeChange={(normalizeVibeStrength) => {
                const current = latest.current.editor.content;
                if (current.kind === "preset")
                  updatePreset({ references: { ...current.references, normalizeVibeStrength } });
              }}
              capabilities={model.capabilities}
              contextKey={editor.id}
              onChange={(vibes) => {
                const current = latest.current.editor.content;
                if (current.kind === "preset")
                  updatePreset({ references: { ...current.references, vibes } });
              }}
            />
            {((model.capabilities?.maxCharacters ?? 0) > 0 ||
              editor.content.characters.length > 0 ||
              editor.content.defaults.useCoords !== null) && (
              <CharacterPositionPolicy
                value={editor.content.defaults.useCoords}
                inherited={model.capabilities?.defaults.useCoords}
                onChange={(useCoords) => {
                  const current = latest.current.editor.content;
                  if (current.kind === "preset")
                    updatePreset({ defaults: { ...current.defaults, useCoords } });
                }}
              />
            )}
            <CharacterListEditor
              key={editor.id}
              value={editor.content.characters}
              onChange={(characters) => updatePreset({ characters })}
              resources={resources}
              models={models}
              capabilities={model.capabilities}
              onError={setError}
              title="角色输出"
            />
            <details>
              <summary>配方默认设置</summary>
              <div className="resource-settings-help">
                <HelpMarker label="配方默认设置说明">
                  仅填写配方负责的设置，留空则继续继承。
                </HelpMarker>
              </div>
              <SettingsEditor
                value={editor.content.defaults}
                models={models}
                mode="preset"
                capabilities={model.capabilities}
                onChange={(defaults) => updatePreset({ defaults })}
              />
              {model.error && (
                <p className="inline-warning" role="alert">
                  {model.error}
                  <Button onClick={model.retry}>重试模型查询</Button>
                </p>
              )}
            </details>
          </>
        )}
      </fieldset>
      <footer className="resource-editor-footer">
        <span className="muted">
          {dirty ? "尚未保存" : editor.revision ? `版本 ${editor.revision}` : "新资源"}
        </span>
        <Button
          className="primary"
          disabled={busy || (!dirty && editor.revision > 0)}
          onClick={() => void save()}
        >
          {busy ? "保存中…" : "保存资源"}
        </Button>
      </footer>
    </section>
  );
}
