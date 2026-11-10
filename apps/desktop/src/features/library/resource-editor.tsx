import { ActionsMenu, Button, Field, HelpMarker, Col, Row, Input, Grid } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";
import { useEffect, useLayoutEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import type { Resource, ResourceFolder } from "@/bindings/workbench";

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
  persisted,
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
  persisted: boolean;
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
      <Col
        gap={0}
        align="stretch"
        as="section"
        className="resource-editor [&_>_fieldset]:gap-[14px] [&_>_fieldset]:flex-1 [&_>_fieldset]:content-start [&_>_fieldset]:w-full [&_>_fieldset]:max-w-[1120px] [&_>_fieldset]:self-center [&_>_fieldset]:grid overflow-auto [padding:var(--space-4)_20px_0] flex flex-col min-w-0"
      >
        <Row
          align="center"
          justify="between"
          gap={3}
          as="header"
          className="ui-heading flex items-center justify-between gap-space-3 min-w-0 min-h-control [&_>_:is(h2,_h3)]:m-0 [&_>_:is(h2,_h3)]:min-w-0 [&_>_:is(h2,_h3)]:text-section [&_>_:is(h2,_h3)]:font-semibold resource-editor-heading [margin:0_0_var(--space-4)]"
        >
          <Button variant="quiet" className="" onClick={() => leave(dismiss)}>
            <ArrowLeft size={14} />
            {t("library.list")}
          </Button>
          <span className="tag inline-flex items-center p-[1px_5px] leading-[19px] text-[10px] rounded-control bg-accent-soft text-accent whitespace-nowrap">
            {editor.content.kind === "chunk" ? t("library.chunk") : t("library.preset")}
          </span>
          <span className="flex-1" />
          {persisted && (
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
        </Row>
        <Grid gap={0} columns={1} as="fieldset" disabled={busy}>
          <Field label={t("library.resourceName")}>
            <Input
              autoComplete="off"
              value={editor.name}
              placeholder={t("library.namePlaceholder")}
              onChange={(event) => update((current) => ({ ...current, name: event.target.value }))}
            />
          </Field>
          <ResourceMetadata
            key={editor.id}
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
                <Row
                  gap={0}
                  align="stretch"
                  className="resource-settings-help flex justify-end mt-[-6px]"
                >
                  <HelpMarker label={t("library.presetDefaultsHelp")}>
                    {t("library.presetDefaultsDescription")}
                  </HelpMarker>
                </Row>
                <SettingsEditor
                  value={editor.content.defaults}
                  models={models}
                  mode="preset"
                  capabilities={model.capabilities}
                  onChange={(defaults) => updatePreset({ defaults })}
                />
                {model.error && (
                  <p className="inline-warning text-danger text-label leading-[1.7]" role="alert">
                    {model.error}
                    <Button onClick={model.retry}>{t("library.retryModelQuery")}</Button>
                  </p>
                )}
              </details>
            </>
          )}
        </Grid>
        <Row
          gap={0}
          as="footer"
          className="resource-editor-footer [&_.muted]:text-caption py-[10px] px-0 mt-[14px] sticky bottom-0 bg-background flex justify-between items-center gap-[10px] border-t border-line-subtle"
        >
          <span className="muted text-muted">
            {dirty
              ? t("library.unsaved")
              : persisted
                ? t("library.saved")
                : t("library.newResource")}
          </span>
          <Button variant="primary" className="" disabled={busy} onClick={() => void save()}>
            {busy ? t("library.saving") : t("library.saveResource")}
          </Button>
        </Row>
      </Col>
    </PromptTransferProvider>
  );
}
