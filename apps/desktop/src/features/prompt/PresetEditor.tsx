import { useEffect, useLayoutEffect, useRef } from "react";
import { FileText, Link2 } from "lucide-react";
import type { InstanceOverride, PresetInstance, Resource } from "../../bindings/workbench";
import { CompositionEditor } from "./CompositionEditor";
import { SettingsEditor } from "./SettingsEditor";
import { PresetOverrides } from "./PresetOverrides";
import { promptApi } from "./api";
import { errorMessage } from "../../shared/host/error";
import { ActionsMenu, Toggle } from "../../shared/ui";

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
                        void promptApi.expandPreset(instance).then(
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
              <PresetOverrides
                composition={composition}
                overrides={binding.overrides}
                resources={resources}
                name={name}
                onChange={override}
              />
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
                      return await promptApi.expandChunk(node);
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
    </article>
  );
}
