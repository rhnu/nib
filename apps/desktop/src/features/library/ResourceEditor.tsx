import { ArrowLeft } from "lucide-react";
import type { Resource } from "../../bindings/workbench";
import { ActionsMenu, Button, Field, HelpMarker } from "../../shared/ui";
import { CompositionEditor } from "../prompt/CompositionEditor";
import { SettingsEditor } from "../prompt/SettingsEditor";
import { promptApi } from "../prompt/api";
import { errorMessage } from "../../shared/host/error";
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
            onChange={(event) => change({ ...editor, name: event.target.value })}
          />
        </Field>
        {editor.content.kind === "chunk" ? (
          <label className="field resource-text">
            <span>提示词内容</span>
            <textarea
              spellCheck={false}
              value={editor.content.text}
              placeholder="输入可复用的提示词…"
              onChange={(event) =>
                change({ ...editor, content: { kind: "chunk", text: event.target.value } })
              }
            />
          </label>
        ) : (
          <>
            <CompositionEditor
              compact
              value={editor.content.composition}
              resources={resources}
              onChange={(composition) => {
                if (editor.content.kind === "preset")
                  change({ ...editor, content: { ...editor.content, composition } });
              }}
              expandChunk={async (node) => {
                try {
                  return await promptApi.expandChunk(node);
                } catch (cause) {
                  setError(errorMessage(cause));
                  return node;
                }
              }}
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
                onChange={(defaults) => {
                  if (editor.content.kind === "preset")
                    change({ ...editor, content: { ...editor.content, defaults } });
                }}
              />
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
