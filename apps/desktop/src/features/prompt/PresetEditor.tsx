import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { FileText, Link2 } from "lucide-react";
import type {
  InstanceOverride,
  GenerationSettings,
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
import { useModelCapabilities } from "../model/useModelCapabilities";
import { settingsWithDefaults } from "./settings";
import {
  CharacterListEditor,
  CharacterOutputOverrides,
  CharacterPositionPolicy,
} from "../characters";
import { setTextOverride, staleTextOverrides } from "../characters/model";
import type { CharacterIssues } from "../characters/model";
import { PreciseReferenceEditor, PreciseReferenceOutputOverrides } from "../references";
import { VibeReferenceEditor, VibeOutputOverrides } from "../vibes";

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
  onPosition,
  characterIssues,
  preciseIssues,
  vibeIssues,
  part = "all",
}: {
  part?: "all" | "characters" | "content";
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
  onPosition?: (characterId: string) => void;
  characterIssues?: CharacterIssues;
  preciseIssues?: Record<string, { field: string; message: string }[]>;
  vibeIssues?: Record<string, { field: string; message: string }[]>;
}) {
  const latest = useRef({ instance, onChange, active: true });
  const details = useRef<HTMLDetailsElement>(null);
  const issueSignature = JSON.stringify([
    characterIssues ?? null,
    preciseIssues ?? null,
    vibeIssues ?? null,
  ]);
  const hasOutputIssues =
    Object.values(characterIssues ?? {}).some((issues) => issues.length > 0) ||
    Object.values(preciseIssues ?? {}).some((issues) => issues.length > 0) ||
    Object.values(vibeIssues ?? {}).some((issues) => issues.length > 0);
  useEffect(() => {
    if (hasOutputIssues && details.current) details.current.open = true;
  }, [issueSignature, hasOutputIssues]);
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
  const characters =
    binding.kind === "expanded"
      ? binding.characters
      : resource?.content.kind === "preset"
        ? resource.content.characters
        : [];
  const references =
    binding.kind === "expanded"
      ? binding.references
      : resource?.content.kind === "preset"
        ? resource.content.references
        : null;
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
  const outputCapabilities = capabilities ?? effectiveCapabilities;
  const inherited =
    effectiveCapabilities && defaults
      ? settingsWithDefaults(effectiveCapabilities.defaults, defaults)
      : undefined;
  const emit = (next: PresetInstance) => {
    if (!latest.current.active) return;
    latest.current.instance = next;
    latest.current.onChange(next);
  };
  const updateLinked = (
    update: (
      value: Extract<PresetInstance["binding"], { kind: "linked" }>,
    ) => Extract<PresetInstance["binding"], { kind: "linked" }>,
  ) => {
    const current = latest.current.instance;
    if (current.binding.kind === "linked") emit({ ...current, binding: update(current.binding) });
  };
  const updateExpanded = (
    patch: Partial<Omit<Extract<PresetInstance["binding"], { kind: "expanded" }>, "kind">>,
  ) => {
    const current = latest.current.instance;
    if (current.binding.kind === "expanded")
      emit({ ...current, binding: { ...current.binding, ...patch } });
  };
  const changeSettings = (next: GenerationSettings) => {
    const current = latest.current.instance;
    emit({
      ...current,
      binding:
        current.binding.kind === "linked"
          ? { ...current.binding, settingsOverrides: next }
          : { ...current.binding, defaults: next },
    });
  };
  const override = (value: InstanceOverride) =>
    updateLinked((current) => ({
      ...current,
      overrides: setTextOverride(current.overrides, value),
    }));
  const staleText =
    binding.kind === "linked" && composition
      ? staleTextOverrides(composition, characters, binding.overrides)
      : [];
  const characterEditor =
    binding.kind === "linked" ? (
      (characters.length > 0 || binding.outputOverrides.characters.length > 0) && (
        <CharacterOutputOverrides
          value={characters}
          overrides={binding.outputOverrides.characters}
          textOverrides={binding.overrides}
          onChange={(characters) =>
            updateLinked((current) => ({
              ...current,
              outputOverrides: { ...current.outputOverrides, characters },
            }))
          }
          onTextChange={override}
          resources={resources}
          capabilities={outputCapabilities}
          onPosition={onPosition}
          name={name}
          issues={characterIssues}
        />
      )
    ) : (
      <CharacterListEditor
        value={binding.characters}
        onChange={(characters) => updateExpanded({ characters })}
        resources={resources}
        capabilities={outputCapabilities}
        onError={onError}
        onPosition={onPosition}
        allowChunk={false}
        title="角色输出"
        issues={characterIssues}
      />
    );
  if (part === "characters")
    return characters.length ||
      (binding.kind === "linked" && binding.outputOverrides.characters.length) ? (
      <section
        className={`preset-character-context ${instance.enabled ? "" : "node-disabled"}`}
        data-preset-instance-id={instance.id}
      >
        <h4>{name}</h4>
        {characterEditor}
      </section>
    ) : null;
  return (
    <article
      className={`preset-instance ${instance.enabled ? "" : "node-disabled"}`}
      data-preset-instance-id={instance.id}
    >
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
            onChange={(enabled) => emit({ ...latest.current.instance, enabled })}
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
                              emit(result);
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
        <details ref={details}>
          <summary>本次内容与设置</summary>
          <div className="preset-detail">
            {binding.kind === "linked" ? (
              <PresetOverrides
                composition={composition}
                overrides={binding.overrides}
                resources={resources}
                name={name}
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
                  model={model}
                  onChange={(composition) => updateExpanded({ composition })}
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
            {part !== "content" &&
              ((outputCapabilities?.maxCharacters ?? 0) > 0 ||
                characters.length > 0 ||
                settings.useCoords !== null) && (
                <CharacterPositionPolicy
                  value={settings.useCoords}
                  inherited={
                    binding.kind === "linked"
                      ? inherited?.useCoords
                      : effectiveCapabilities?.defaults.useCoords
                  }
                  onChange={(useCoords) => {
                    const current = latest.current.instance.binding;
                    changeSettings({
                      ...(current.kind === "linked" ? current.settingsOverrides : current.defaults),
                      useCoords,
                    });
                  }}
                />
              )}
            {references &&
              (binding.kind === "linked" ? (
                <PreciseReferenceOutputOverrides
                  value={references.precise}
                  overrides={binding.outputOverrides.precise}
                  onChange={(precise) =>
                    updateLinked((current) => ({
                      ...current,
                      outputOverrides: { ...current.outputOverrides, precise },
                    }))
                  }
                  capabilities={outputCapabilities}
                  contextKey={`${instance.id}:${binding.resourceId}`}
                  issues={preciseIssues}
                />
              ) : (
                <PreciseReferenceEditor
                  value={references.precise}
                  onChange={(precise) => {
                    const current = latest.current.instance.binding;
                    if (current.kind === "expanded")
                      updateExpanded({ references: { ...current.references, precise } });
                  }}
                  capabilities={outputCapabilities}
                  contextKey={instance.id}
                  issues={preciseIssues}
                />
              ))}
            {references &&
              outputCapabilities?.vibeReference.reason !== "conflictWithPreciseReference" &&
              (binding.kind === "linked" ? (
                <VibeOutputOverrides
                  value={references.vibes}
                  overrides={binding.outputOverrides.vibes}
                  normalizeValue={binding.outputOverrides.normalizeVibeStrength}
                  normalizeInherited={references.normalizeVibeStrength}
                  onNormalizeChange={(normalizeVibeStrength) =>
                    updateLinked((current) => ({
                      ...current,
                      outputOverrides: { ...current.outputOverrides, normalizeVibeStrength },
                    }))
                  }
                  onChange={(vibes) =>
                    updateLinked((current) => ({
                      ...current,
                      outputOverrides: { ...current.outputOverrides, vibes },
                    }))
                  }
                  capabilities={outputCapabilities}
                  contextKey={`${instance.id}:${binding.resourceId}`}
                  issues={vibeIssues}
                />
              ) : (
                <VibeReferenceEditor
                  value={references.vibes}
                  normalizeValue={references.normalizeVibeStrength}
                  onNormalizeChange={(normalizeVibeStrength) => {
                    const current = latest.current.instance.binding;
                    if (current.kind === "expanded")
                      updateExpanded({
                        references: { ...current.references, normalizeVibeStrength },
                      });
                  }}
                  onChange={(vibes) => {
                    const current = latest.current.instance.binding;
                    if (current.kind === "expanded")
                      updateExpanded({ references: { ...current.references, vibes } });
                  }}
                  capabilities={outputCapabilities}
                  contextKey={instance.id}
                  issues={vibeIssues}
                />
              ))}
            {part !== "content" && characterEditor}
            {staleText.map((item) => (
              <div
                className="character-stale-override"
                data-prompt-node-id={item.nodeId}
                key={item.nodeId}
              >
                <span>
                  已移除片段的覆盖 <code>{item.nodeId}</code>
                </span>
                <Button
                  onClick={() => override({ nodeId: item.nodeId, enabled: null, text: null })}
                >
                  移除失效覆盖
                </Button>
              </div>
            ))}
            <section className="preset-settings">
              <h3>{binding.kind === "linked" ? "本次设置覆盖" : "配方默认设置"}</h3>
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
                onChange={changeSettings}
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
