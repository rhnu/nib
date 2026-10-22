import { RotateCcw } from "lucide-react";
import type { Composition, InstanceOverride, Resource } from "../../bindings/workbench";
import { IconButton, Toggle } from "../../shared/ui";
import { PromptTextEditor } from "./PromptTextEditor";
/** Linked instances keep only explicit text and enabled-state overrides. */
export function PresetOverrides({
  composition,
  overrides,
  resources,
  name,
  models,
  model,
  onChange: override,
}: {
  composition: Composition;
  overrides: InstanceOverride[];
  resources: Map<string, Resource>;
  name: string;
  models?: string[];
  model?: string;
  onChange: (value: InstanceOverride) => void;
}) {
  return (
    <>
      {(["positive", "negative"] as const).map((scope) => (
        <section key={scope}>
          <h3>{scope === "positive" ? "基础提示" : "负面提示"}</h3>
          {composition[scope].length === 0 && <p className="muted">没有内容</p>}
          {composition[scope].map((node) => {
            const local = overrides.find((item) => item.nodeId === node.id) ?? {
              nodeId: node.id,
              enabled: null,
              text: null,
            };
            const source = node.kind === "chunk" ? resources.get(node.resourceId) : null;
            const original =
              node.kind === "text"
                ? node.text
                : (node.overrideText ??
                  (source?.content.kind === "chunk" ? source.content.text : ""));
            return (
              <div className="instance-override" key={node.id}>
                <header>
                  <span>{node.kind === "chunk" ? (source?.name ?? "Chunk 缺失") : "文本"}</span>
                  <span className="spacer" />
                  <Toggle
                    label="启用配方片段"
                    checked={local.enabled ?? node.enabled}
                    onChange={(enabled) => override({ ...local, enabled })}
                  />
                  <IconButton
                    label="恢复原资源内容与状态"
                    disabled={local.enabled === null && local.text === null}
                    onClick={() => override({ nodeId: node.id, enabled: null, text: null })}
                  >
                    <RotateCcw size={14} />
                  </IconButton>
                </header>
                <PromptTextEditor
                  label={`${name} ${scope === "positive" ? "基础" : "负面"}提示本次覆盖`}
                  models={models}
                  model={model}
                  value={local.text ?? original}
                  onChange={(text) => override({ ...local, text })}
                />
                {(local.text !== null || local.enabled !== null) && (
                  <span className="tag">本次覆盖</span>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </>
  );
}
