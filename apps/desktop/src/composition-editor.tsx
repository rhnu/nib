import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Link2, Plus, RotateCcw, Type } from "lucide-react";
import type {
  Composition,
  GenerationSettings,
  PromptNode,
  Resource,
  ResolvedSettings,
} from "./bindings/workbench";
import { ActionsMenu, IconButton, Modal, Toggle } from "./ui";

export const emptySettings = (): GenerationSettings => ({
  model: null,
  size: null,
  steps: null,
  scale: null,
  sampler: null,
});
export const emptyComposition = (): Composition => ({ positive: [], negative: [] });
export const textNode = (): PromptNode => ({
  kind: "text",
  id: crypto.randomUUID(),
  enabled: true,
  text: "",
});

export function moveItem<T>(items: T[], index: number, offset: number): T[] {
  const target = index + offset;
  if (target < 0 || target >= items.length) return items;
  const copy = [...items];
  [copy[index], copy[target]] = [copy[target], copy[index]];
  return copy;
}

export function CompositionEditor({
  value,
  onChange,
  resources,
  addChunk,
  expandChunk,
  compact = false,
  allowChunk = true,
}: {
  value: Composition;
  onChange: (value: Composition) => void;
  resources: Map<string, Resource>;
  addChunk?: (scope: "positive" | "negative") => void;
  expandChunk: (node: PromptNode) => Promise<PromptNode>;
  compact?: boolean;
  allowChunk?: boolean;
}) {
  const [pickerScope, setPickerScope] = useState<"positive" | "negative" | null>(null);
  const [selectedChunk, setSelectedChunk] = useState("");
  const chunks = [...resources.values()].filter((resource) => resource.content.kind === "chunk");
  const update = (scope: "positive" | "negative", nodes: PromptNode[]) =>
    onChange({ ...value, [scope]: nodes });
  return (
    <div className={`composition ${compact ? "compact-composition" : ""}`}>
      {(["positive", "negative"] as const).map((scope) => (
        <section className="prompt-scope" key={scope}>
          <header className="section-heading">
            <h2>
              {scope === "positive" ? "基础提示" : "负面提示"}
              <span className="count">{value[scope].length}</span>
            </h2>
            <div className="button-group">
              {allowChunk && (
                <button
                  type="button"
                  className="quiet"
                  onClick={() => (addChunk ? addChunk(scope) : setPickerScope(scope))}
                >
                  <Link2 size={14} />
                  添加 Chunk
                </button>
              )}
              <button
                type="button"
                className="quiet"
                onClick={() => update(scope, [...value[scope], textNode()])}
              >
                <Plus size={14} />
                文本
              </button>
            </div>
          </header>
          {value[scope].length === 0 && (
            <div className="scope-empty">
              <Type size={19} />
              <p>
                {scope === "positive"
                  ? "用文本描写画面，或添加可复用的 Chunk。"
                  : "添加希望排除的内容。"}
              </p>
              <button type="button" onClick={() => update(scope, [textNode()])}>
                开始编写
              </button>
            </div>
          )}
          {value[scope].map((node, index) => (
            <NodeEditor
              key={node.id}
              node={node}
              resource={node.kind === "chunk" ? resources.get(node.resourceId) : undefined}
              onChange={(next) =>
                update(
                  scope,
                  value[scope].map((item) => (item.id === node.id ? next : item)),
                )
              }
              up={() => update(scope, moveItem(value[scope], index, -1))}
              down={() => update(scope, moveItem(value[scope], index, 1))}
              canUp={index > 0}
              canDown={index < value[scope].length - 1}
              remove={() =>
                update(
                  scope,
                  value[scope].filter((item) => item.id !== node.id),
                )
              }
              expand={expandChunk}
            />
          ))}
        </section>
      ))}
      <Modal open={pickerScope !== null} onClose={() => setPickerScope(null)} title="添加 Chunk">
        <label className="field">
          <span>资源</span>
          <select value={selectedChunk} onChange={(event) => setSelectedChunk(event.target.value)}>
            <option value="">选择 Chunk…</option>
            {chunks.map((chunk) => (
              <option key={chunk.id} value={chunk.id}>
                {chunk.name}
              </option>
            ))}
          </select>
        </label>
        {chunks.length === 0 && <p className="help-note">还没有 Chunk。请先在资源库中创建。</p>}
        <div className="dialog-actions">
          <button onClick={() => setPickerScope(null)}>取消</button>
          <button
            className="primary"
            disabled={!selectedChunk}
            onClick={() => {
              if (pickerScope && resources.has(selectedChunk))
                update(pickerScope, [
                  ...value[pickerScope],
                  {
                    kind: "chunk",
                    id: crypto.randomUUID(),
                    enabled: true,
                    resourceId: selectedChunk,
                    overrideText: null,
                  },
                ]);
              setPickerScope(null);
              setSelectedChunk("");
            }}
          >
            添加
          </button>
        </div>
      </Modal>
    </div>
  );
}

function NodeEditor({
  node,
  resource,
  onChange,
  up,
  down,
  canUp,
  canDown,
  remove,
  expand,
}: {
  node: PromptNode;
  resource?: Resource;
  onChange: (node: PromptNode) => void;
  up: () => void;
  down: () => void;
  canUp: boolean;
  canDown: boolean;
  remove: () => void;
  expand: (node: PromptNode) => Promise<PromptNode>;
}) {
  const latest = useRef({ node, onChange, active: true });
  useLayoutEffect(() => {
    latest.current.node = node;
    latest.current.onChange = onChange;
  }, [node, onChange]);
  useEffect(() => {
    const current = latest.current;
    current.active = true;
    return () => {
      current.active = false;
    };
  }, []);
  const sourceText = resource?.content.kind === "chunk" ? resource.content.text : "";
  return (
    <article className={`prompt-node ${node.enabled ? "" : "node-disabled"}`}>
      <header className="node-heading">
        <span className="node-label">
          {node.kind === "chunk" ? <Link2 size={14} /> : <Type size={14} />}
          {node.kind === "chunk" ? (resource?.name ?? "资源缺失") : "文本"}
        </span>
        <div className="button-group">
          {node.kind === "chunk" && node.overrideText !== null && (
            <span className="tag">本次覆盖</span>
          )}
          <Toggle
            checked={node.enabled}
            label="启用片段"
            onChange={(enabled) => onChange({ ...node, enabled })}
          />
          <ActionsMenu
            label="片段操作"
            items={[
              { label: "上移", action: up, disabled: !canUp },
              { label: "下移", action: down, disabled: !canDown },
              ...(node.kind === "chunk"
                ? [
                    {
                      label: "展开为独立文本",
                      action: () => {
                        void expand(node).then((result) => {
                          if (
                            latest.current.active &&
                            latest.current.node === node &&
                            result !== node
                          )
                            latest.current.onChange(result);
                        });
                      },
                    },
                    {
                      label: "撤销本次覆盖",
                      action: () => onChange({ ...node, overrideText: null }),
                      disabled: node.overrideText === null,
                    },
                  ]
                : []),
              { label: "移除片段", action: remove, danger: true },
            ]}
          />
        </div>
      </header>
      <textarea
        aria-label={
          node.kind === "text" ? "提示词文本" : `${resource?.name ?? "缺失 Chunk"} 的本次内容`
        }
        spellCheck={false}
        value={node.kind === "text" ? node.text : (node.overrideText ?? sourceText)}
        placeholder={
          node.kind === "text"
            ? "输入提示词…"
            : resource
              ? "此 Chunk 内容为空"
              : "引用的资源不存在；可移除引用或恢复原资源。"
        }
        onChange={(event) =>
          onChange(
            node.kind === "text"
              ? { ...node, text: event.target.value }
              : { ...node, overrideText: event.target.value },
          )
        }
      />
      <footer className="node-footer">
        <span>
          {node.kind === "chunk" ? "链接资源 · 这里的修改只用于当前实例" : "当前草稿文本"}
        </span>
        <div className="button-group">
          <IconButton label="上移片段" disabled={!canUp} onClick={up}>
            <ArrowUp size={13} />
          </IconButton>
          <IconButton label="下移片段" disabled={!canDown} onClick={down}>
            <ArrowDown size={13} />
          </IconButton>
        </div>
      </footer>
    </article>
  );
}

export function SettingsEditor({
  value,
  onChange,
  models,
  resolved,
  compact = false,
}: {
  value: GenerationSettings;
  onChange: (value: GenerationSettings) => void;
  models: string[];
  resolved?: ResolvedSettings;
  compact?: boolean;
}) {
  const number = (raw: string): number | null =>
    raw.trim() === "" ? null : Number.isFinite(Number(raw)) ? Number(raw) : null;
  return (
    <div className={`settings-fields ${compact ? "settings-compact" : ""}`}>
      <label className="field full">
        <span>模型</span>
        <select
          value={value.model ?? ""}
          onChange={(event) => onChange({ ...value, model: event.target.value || null })}
        >
          <option value="">继承{resolved ? ` · ${resolved.model}` : ""}</option>
          {models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </label>
      <div className="field full">
        <span>尺寸</span>
        <div className="size-inputs">
          <input
            aria-label="宽度"
            type="number"
            placeholder={resolved ? String(resolved.size.width) : "继承宽度"}
            value={value.size?.width ?? ""}
            onChange={(event) => {
              const width = number(event.target.value);
              onChange({
                ...value,
                size:
                  width === null
                    ? null
                    : { width, height: value.size?.height ?? resolved?.size.height ?? width },
              });
            }}
          />
          <span>×</span>
          <input
            aria-label="高度"
            type="number"
            placeholder={resolved ? String(resolved.size.height) : "继承高度"}
            value={value.size?.height ?? ""}
            onChange={(event) => {
              const height = number(event.target.value);
              onChange({
                ...value,
                size:
                  height === null
                    ? null
                    : { height, width: value.size?.width ?? resolved?.size.width ?? height },
              });
            }}
          />
          <IconButton
            label="恢复继承尺寸"
            disabled={value.size === null}
            onClick={() => onChange({ ...value, size: null })}
          >
            <RotateCcw size={13} />
          </IconButton>
        </div>
      </div>
      {(
        [
          ["steps", "Steps"],
          ["scale", "Guidance"],
        ] as const
      ).map(([key, label]) => (
        <label className="field" key={key}>
          <span>{label}</span>
          <input
            type="number"
            step="any"
            value={value[key] ?? ""}
            placeholder={resolved ? String(resolved[key]) : "继承"}
            onChange={(event) => onChange({ ...value, [key]: number(event.target.value) })}
          />
        </label>
      ))}
      <label className="field full">
        <span>采样器</span>
        <input
          value={value.sampler ?? ""}
          placeholder={resolved?.sampler ?? "继承"}
          onChange={(event) => onChange({ ...value, sampler: event.target.value || null })}
        />
      </label>
    </div>
  );
}
