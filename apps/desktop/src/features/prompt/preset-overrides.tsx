import { t, useTranslation } from "@/shared/i18n";
import { useLayoutEffect, useRef } from "react";
import { RotateCcw } from "lucide-react";
import type { Composition, InstanceOverride, Resource } from "@/bindings/workbench";
import { IconButton, Toggle } from "@/shared/ui";
import { PromptTextEditor } from "./prompt-text-editor";
import { setTextOverride } from "@/features/characters/model";

/** Linked instances keep only explicit text and enabled-state overrides. */
export function PresetOverrides({
  composition,
  overrides,
  resources,
  name,
  model,
  onChange: override,
  errorScopes = [],
}: {
  composition: Composition;
  overrides: InstanceOverride[];
  resources: Map<string, Resource>;
  name: string;
  model?: string;
  onChange: (value: InstanceOverride) => void;
  errorScopes?: string[];
}) {
  useTranslation();

  const latest = useRef({ overrides, override });
  useLayoutEffect(() => {
    latest.current = { overrides, override };
  }, [overrides, override]);

  const update = (nodeId: string, patch: Partial<Omit<InstanceOverride, "nodeId">>) => {
    const current = latest.current;
    const previous = current.overrides.find((item) => item.nodeId === nodeId) ?? {
      nodeId,
      enabled: null,
      text: null,
    };
    const next = { ...previous, ...patch };
    current.overrides = setTextOverride(current.overrides, next);
    current.override(next);
  };

  return (
    <>
      {(["positive", "negative"] as const).map((scope) => (
        <section
          key={scope}
          data-prompt-scope={scope}
          data-character-field={scope}
          data-has-errors={errorScopes.includes(scope) || undefined}
        >
          <h3>{scope === "positive" ? t("prompt.basePrompt") : t("prompt.negativePrompt")}</h3>
          {composition[scope].length === 0 && <p className="muted">{t("prompt.noContent")}</p>}
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
              <div className="instance-override" key={node.id} data-prompt-node-id={node.id}>
                <header>
                  <span>
                    {node.kind === "chunk"
                      ? (source?.name ?? t("prompt.chunkMissing"))
                      : t("prompt.text")}
                  </span>
                  <span className="spacer" />
                  <Toggle
                    label={t("prompt.enablePresetSegment")}
                    checked={local.enabled ?? node.enabled}
                    onChange={(enabled) => update(node.id, { enabled })}
                  />
                  <IconButton
                    label={t("prompt.restoreResourceContent")}
                    disabled={local.enabled === null && local.text === null}
                    onClick={() => update(node.id, { enabled: null, text: null })}
                  >
                    <RotateCcw size={14} />
                  </IconButton>
                </header>
                <PromptTextEditor
                  label={t("prompt.instancePromptOverride", {
                    value0: name,
                    value1: scope === "positive" ? t("prompt.base") : t("prompt.negative"),
                  })}
                  model={model}
                  value={local.text ?? original}
                  onChange={(text) => update(node.id, { text })}
                />
                {(local.text !== null || local.enabled !== null) && (
                  <span className="tag">{t("prompt.instanceOverride")}</span>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </>
  );
}
