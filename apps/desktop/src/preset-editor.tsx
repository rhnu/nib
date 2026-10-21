import { useEffect, useLayoutEffect, useRef } from "react";
import { ArrowDown, ArrowUp, FileText, Link2, RotateCcw } from "lucide-react";
import type { InstanceOverride, PresetInstance, Resource } from "./bindings/workbench";
import { CompositionEditor, SettingsEditor } from "./composition-editor";
import { api, errorMessage } from "./workbench-api";
import { ActionsMenu, IconButton, Toggle } from "./ui";

export function PresetEditor({
  instance,
  resources,
  models,
  onChange,
  onRemove,
  up,
  down,
  canUp,
  canDown,
  onError,
}: {
  instance: PresetInstance;
  resources: Map<string, Resource>;
  models: string[];
  onChange: (instance: PresetInstance) => void;
  onRemove: () => void;
  up: () => void;
  down: () => void;
  canUp: boolean;
  canDown: boolean;
  onError: (message: string) => void;
}) {
  const latest = useRef({ instance, onChange, active: true });
  useLayoutEffect(() => {
    latest.current.instance = instance;
    latest.current.onChange = onChange;
  }, [instance, onChange]);
  useEffect(() => {
    const current = latest.current;
    current.active = true;
    return () => {
      current.active = false;
    };
  }, []);
  const binding = instance.binding;
  const resource = binding.kind === "linked" ? resources.get(binding.resourceId) : undefined;
  const composition =
    binding.kind === "expanded"
      ? binding.composition
      : resource?.content.kind === "preset"
        ? resource.content.composition
        : null;
  const name = binding.kind === "expanded" ? binding.name : (resource?.name ?? "资源缺失");
  const override = (value: InstanceOverride) => {
    if (binding.kind !== "linked") return;
    const overrides = binding.overrides.filter((item) => item.nodeId !== value.nodeId);
    if (value.enabled !== null || value.text !== null) overrides.push(value);
    onChange({ ...instance, binding: { ...binding, overrides } });
  };
  return (
    <article className={`preset-instance ${instance.enabled ? "" : "node-disabled"}`}>
      <header className="node-heading">
        <span className="node-label">
          {binding.kind === "linked" ? <Link2 size={15} /> : <FileText size={15} />}
          {name}
        </span>
        <div className="button-group">
          <span className="tag">{binding.kind === "linked" ? "链接" : "已展开"}</span>
          <Toggle
            label={`启用 ${name}`}
            checked={instance.enabled}
            onChange={(enabled) => onChange({ ...instance, enabled })}
          />
          <ActionsMenu
            label={`${name} 的操作`}
            items={[
              { label: "上移", action: up, disabled: !canUp },
              { label: "下移", action: down, disabled: !canDown },
              ...(binding.kind === "linked"
                ? [
                    {
                      label: "展开为独立配方",
                      action: () => {
                        void api.expandPreset(instance).then(
                          (result) => {
                            if (latest.current.active && latest.current.instance === instance)
                              latest.current.onChange(result);
                            else if (latest.current.active)
                              onError("配方已发生修改，请再次展开以使用最新内容。");
                          },
                          (cause: unknown) => onError(errorMessage(cause)),
                        );
                      },
                    },
                  ]
                : []),
              { label: "移除配方", action: onRemove, danger: true },
            ]}
          />
        </div>
      </header>
      {composition ? (
        <details>
          <summary>本次内容与设置</summary>
          <div className="preset-detail">
            {binding.kind === "linked" ? (
              <>
                <p className="help-note">局部修改只保存在本次实例中，原资源保持不变。</p>
                {(["positive", "negative"] as const).map((scope) => (
                  <section key={scope}>
                    <h3>{scope === "positive" ? "基础提示" : "负面提示"}</h3>
                    {composition[scope].length === 0 && <p className="muted">没有内容</p>}
                    {composition[scope].map((node) => {
                      const local = binding.overrides.find((item) => item.nodeId === node.id) ?? {
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
                            <span>
                              {node.kind === "chunk" ? (source?.name ?? "Chunk 缺失") : "文本"}
                            </span>
                            <span className="spacer" />
                            <Toggle
                              label="启用配方片段"
                              checked={local.enabled ?? node.enabled}
                              onChange={(enabled) => override({ ...local, enabled })}
                            />
                            <IconButton
                              label="恢复原资源内容与状态"
                              disabled={local.enabled === null && local.text === null}
                              onClick={() =>
                                override({ nodeId: node.id, enabled: null, text: null })
                              }
                            >
                              <RotateCcw size={14} />
                            </IconButton>
                          </header>
                          <textarea
                            aria-label={`${name} ${scope === "positive" ? "基础" : "负面"}提示本次覆盖`}
                            spellCheck={false}
                            value={local.text ?? original}
                            onChange={(event) => override({ ...local, text: event.target.value })}
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
            ) : (
              <>
                <CompositionEditor
                  compact
                  allowChunk={false}
                  value={binding.composition}
                  resources={resources}
                  onChange={(next) =>
                    onChange({ ...instance, binding: { ...binding, composition: next } })
                  }
                  expandChunk={async (node) => {
                    try {
                      return await api.expandChunk(node);
                    } catch (cause) {
                      onError(errorMessage(cause));
                      return node;
                    }
                  }}
                />
                <SettingsEditor
                  value={binding.defaults}
                  models={models}
                  onChange={(defaults) =>
                    onChange({ ...instance, binding: { ...binding, defaults } })
                  }
                />
              </>
            )}
          </div>
        </details>
      ) : (
        <p className="inline-warning">引用的 Preset 已不存在。请移除引用或恢复资源。</p>
      )}
      <footer className="preset-footer">
        <span>
          {binding.kind === "linked" ? "资源定义 → 本次实例" : "独立内容 · 不再跟随资源更新"}
        </span>
        <div className="button-group">
          <IconButton label="上移配方" disabled={!canUp} onClick={up}>
            <ArrowUp size={13} />
          </IconButton>
          <IconButton label="下移配方" disabled={!canDown} onClick={down}>
            <ArrowDown size={13} />
          </IconButton>
        </div>
      </footer>
    </article>
  );
}
