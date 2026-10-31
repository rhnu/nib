import { t, useTranslation } from "@/shared/i18n";
import { useEffect, useLayoutEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import type { Resource, ResourceFolder } from "@/bindings/workbench";
import { ActionsMenu, Button, Field, HelpMarker } from "@/shared/ui";
import { PromptTransferProvider } from "@/features/prompt/prompt-transfer-context";
import { transferPromptNode } from "@/features/prompt/prompt-transfer";
import { CompositionEditor } from "@/features/prompt/composition-editor";
import { SettingsEditor } from "@/features/prompt/settings-editor";
import { promptApi } from "@/features/prompt/api";
import { useModelCapabilities } from "@/features/model/use-model-capabilities";
import { PromptTextEditor } from "@/features/prompt/prompt-text-editor";
import { CharacterListEditor, CharacterPositionPolicy } from "@/features/characters";
import { PreciseReferenceEditor } from "@/features/references";
import { ResourceMetadata } from "./resource-metadata";
import { VibeReferenceEditor } from "@/features/vibes";

export function ResourceEditor({
  editor,
  dirty,
  busy,
  models,
  resources,
  folders,
  tags,
  change,
  changeCover,
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
  folders: ResourceFolder[];
  tags: string[];
  change: (resource: Resource) => void;
  changeCover: (assetId: string, pending: boolean) => void;
  leave: (action: () => void) => void;
  dismiss: () => void;
  remove: () => void;
  save: () => Promise<void>;
  setError: (message: unknown) => void;
}) {
  useTranslation();

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
    <PromptTransferProvider
      onMove={(from, to, nodeId, beforeId) =>
        update((current) => {
          if (current.content.kind !== "preset") return current;
          const content = transferPromptNode(current.content, from, to, nodeId, beforeId);
          return content ? { ...current, content } : current;
        })
      }
    >
      <section className="resource-editor">
        <header className="resource-editor-heading">
          <Button className="quiet" onClick={() => leave(dismiss)}>
            <ArrowLeft size={14} />
            {t("library.list")}
          </Button>
          <span className="tag">
            {editor.content.kind === "chunk" ? t("library.chunk") : t("library.preset")}
          </span>
          <span className="spacer" />
          {editor.revision > 0 && (
            <ActionsMenu
              label={t("library.manageResource")}
              items={[
                {
                  label: t("library.deleteResource"),
                  danger: true,
                  action: remove,
                  disabled: busy,
                },
              ]}
            />
          )}
        </header>
        <fieldset disabled={busy}>
          <Field label={t("library.resourceName")}>
            <input
              value={editor.name}
              placeholder={t("library.namePlaceholder")}
              onChange={(event) => update((current) => ({ ...current, name: event.target.value }))}
            />
          </Field>
          <ResourceMetadata
            resource={editor}
            models={models}
            folders={folders}
            tags={tags}
            onChange={(next) => update(() => next)}
            onCoverChange={changeCover}
            onError={setError}
          />
          {editor.content.kind === "chunk" ? (
            <div className="resource-text">
              <PromptTextEditor
                label={t("library.promptContent")}
                value={editor.content.text}
                model={model.capabilities?.model}
                disabled={busy}
                placeholder={t("library.promptPlaceholder")}
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
                negativeSupported={model.capabilities?.customNegativePrompts}
                contextLabel={editor.name}
                key={`composition:${editor.id}`}
                compact
                value={editor.content.composition}
                resources={resources}
                model={model.capabilities?.model}
                onChange={(composition) => updatePreset({ composition })}
                expandChunk={async (node) => {
                  try {
                    return await promptApi.expandChunk(node);
                  } catch (cause) {
                    setError(cause);
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
                contextLabel={editor.name}
                key={`characters:${editor.id}`}
                value={editor.content.characters}
                onChange={(characters) => updatePreset({ characters })}
                resources={resources}
                capabilities={model.capabilities}
                onError={setError}
                title={t("library.characterOutput")}
              />
              <details>
                <summary>{t("library.presetDefaults")}</summary>
                <div className="resource-settings-help">
                  <HelpMarker label={t("library.presetDefaultsHelp")}>
                    {t("library.presetDefaultsDescription")}
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
                    <Button onClick={model.retry}>{t("library.retryModelQuery")}</Button>
                  </p>
                )}
              </details>
            </>
          )}
        </fieldset>
        <footer className="resource-editor-footer">
          <span className="muted">
            {dirty
              ? t("library.unsaved")
              : editor.revision
                ? t("library.revision", { value0: editor.revision })
                : t("library.newResource")}
          </span>
          <Button
            className="primary"
            disabled={busy || (!dirty && editor.revision > 0)}
            onClick={() => void save()}
          >
            {busy ? t("library.saving") : t("library.saveResource")}
          </Button>
        </footer>
      </section>
    </PromptTransferProvider>
  );
}
