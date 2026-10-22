import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { FileText, Link2 } from "lucide-react";
import type {
  InstanceOverride,
  ModelCapabilities,
  PresetInstance,
  Resource,
} from "../../bindings/workbench";
import { CompositionEditor } from "./CompositionEditor";
import { SettingsEditor } from "./SettingsEditor";
import { PresetOverrides } from "./PresetOverrides";
import { promptApi } from "./api";
import { errorMessage } from "../../shared/host/error";
import { ActionsMenu, Button, Toggle } from "../../shared/ui";
import { useModelCapabilities } from "../workbench/useModelCapabilities";
import { settingsWithDefaults } from "./settings";

export function PresetEditor({
  instance,
  resources,
  models,
  capabilities,
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
  capabilities?: ModelCapabilities | null;
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
  const defaults =
    binding.kind === "expanded"
      ? binding.defaults
      : resource?.content.kind === "preset"
        ? resource.content.defaults
        : null;
  const settings = binding.kind === "linked" ? binding.settingsOverrides : binding.defaults;
  const model = settings.model ?? defaults?.model ?? capabilities?.model;
  const hintSettings = useMemo(
    () => (defaults ? settingsWithDefaults(defaults, settings) : settings),
    [defaults, settings],
  );
  const capabilityState = useModelCapabilities(model, hintSettings);
  const effectiveCapabilities = capabilityState.capabilities;
  const inherited =
    effectiveCapabilities && defaults
      ? settingsWithDefaults(effectiveCapabilities.defaults, defaults)
      : undefined;
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
                models={models}
                model={model}
                onChange={override}
              />
            ) : (
              <>
                <CompositionEditor
                  compact
                  allowChunk={false}
                  value={binding.composition}
                  resources={resources}
                  models={models}
                  model={model}
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
              </>
            )}
            <section className="preset-settings">
              <h3>{binding.kind === "linked" ? "本次设置覆盖" : "配方默认设置"}</h3>
              <p className="setting-note">
                {binding.kind === "linked"
                  ? "留空继续使用原配方的声明；修改只影响本次实例。"
                  : "仅声明配方负责的设置，其余继续继承。"}
              </p>
              {capabilityState.loading && <output className="muted">正在读取模型选项…</output>}
              {capabilityState.error && (
                <div className="inline-warning" role="alert">
                  {capabilityState.error}
                  <Button className="quiet" onClick={capabilityState.retry}>
                    重试
                  </Button>
                </div>
              )}
              <SettingsEditor
                value={settings}
                models={models}
                capabilities={effectiveCapabilities}
                resolved={binding.kind === "linked" ? inherited : undefined}
                mode={binding.kind === "linked" ? "instance" : "preset"}
                onChange={(next) =>
                  onChange({
                    ...instance,
                    binding:
                      binding.kind === "linked"
                        ? { ...binding, settingsOverrides: next }
                        : { ...binding, defaults: next },
                  })
                }
              />
            </section>
          </div>
        </details>
      ) : (
        <p className="inline-warning">引用的 Preset 已不存在。请移除引用或恢复资源。</p>
      )}
    </article>
  );
}
