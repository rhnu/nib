import { HelpMarker, IconButton, Row, Grid, Button } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";
import { useState, type DragEvent } from "react";
import { GripVertical, Plus } from "lucide-react";
import type { Draft, ModelCapabilities, Resource, ResolvedDraft } from "@/bindings/workbench";
import type { GenerationQuote, ParameterDiagnostic } from "@/bindings/generation";

import { PresetEditor } from "@/features/prompt/preset-editor";
import { SettingsEditor } from "@/features/prompt/settings-editor";
import { moveItem } from "@/features/prompt/model";
import { ImageOperationPanel } from "@/features/inputs/image-operation-panel";
import type { ImageOperationAction } from "@/features/inputs/image-operation";
import { PreciseReferenceEditor, showPreciseReferences } from "@/features/references";
import { VibeReferenceEditor, showVibeReferences } from "@/features/vibes";
import type { ScopedOutputIssues } from "./output-issues";

const presetDragType = "application/x-nib-preset-instance";

export function ContextRail({
  draft,
  resources,
  models,
  resolved,
  capabilities,
  diagnostics,
  errorFields,
  readCurrentDraft,
  edit,
  onAddPreset,
  setError,
  estimate,
  onRestore,
  onRequestOperation,
  onPrepareImportedOperation,
  onReturnToText,
  imageInputVersion,
  onEditMask,
  onPosition,
  outputIssues,
}: {
  draft: Draft;
  resources: Map<string, Resource>;
  models: string[];
  resolved: ResolvedDraft | null;
  capabilities: ModelCapabilities | null;
  diagnostics: ParameterDiagnostic[];
  errorFields: string[];
  readCurrentDraft: () => Draft;
  edit: (draft: Draft) => void;
  onAddPreset: () => void;
  setError: (message: unknown) => void;
  estimate: GenerationQuote | null;
  onRestore: (draft: Draft) => void;
  onRequestOperation: (id: string, kind: ImageOperationAction) => void;
  onPrepareImportedOperation: (id: string, kind: ImageOperationAction) => Promise<void>;
  onReturnToText: () => void;
  imageInputVersion: number;
  onEditMask: (assetId: string) => void;
  onPosition: (characterId?: string, presetInstanceId?: string) => void;
  outputIssues: ScopedOutputIssues;
}) {
  useTranslation();

  const [presetDropBefore, setPresetDropBefore] = useState<string | null>(null);

  const dropPreset = (event: DragEvent<HTMLElement>, beforeId?: string) => {
    if (!event.dataTransfer.types.includes(presetDragType)) return;
    event.preventDefault();
    event.stopPropagation();
    setPresetDropBefore(null);
    const id = event.dataTransfer.getData(presetDragType);
    if (id === beforeId) return;
    const current = readCurrentDraft();
    const from = current.presets.findIndex((item) => item.id === id);
    const before = beforeId
      ? current.presets.findIndex((item) => item.id === beforeId)
      : current.presets.length;
    if (from < 0 || before < 0) return;
    const target = before > from ? before - 1 : before;
    const presets = moveItem(current.presets, from, target - from);
    if (presets !== current.presets) edit({ ...current, presets });
  };

  return (
    <div className="context-rail min-w-0 [&_>_section]:py-space-3 [&_>_section]:px-space-4 [&_>_section]:border-b [&_>_section]:border-line-subtle">
      {draft.inputs.operation.kind !== "upscale" && (
        <section className="preset-context">
          <Row
            align="center"
            justify="between"
            gap={3}
            as="header"
            className="flex items-center justify-between gap-space-3 min-w-0 min-h-control mb-space-2 [&_>_:is(h2,_h3)]:m-0 [&_>_:is(h2,_h3)]:min-w-0 [&_>_:is(h2,_h3)]:text-section [&_>_:is(h2,_h3)]:font-semibold"
          >
            <h2>
              {t("workbench.presets")}
              <span className="count ml-space-3 text-caption text-muted font-[450]">
                {draft.presets.length}
              </span>
              <HelpMarker label={t("workbench.presetsHelp")}>
                {t("workbench.presetsDescription")}
              </HelpMarker>
            </h2>
            <IconButton label={t("workbench.addPreset")} onClick={onAddPreset}>
              <Plus size={16} />
            </IconButton>
          </Row>
          <div
            className={
              presetDropBefore === "end"
                ? "prompt-drop-end [box-shadow:0_2px_0_var(--accent)]"
                : undefined
            }
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes(presetDragType)) return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "move";
              setPresetDropBefore("end");
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                setPresetDropBefore(null);
            }}
            onDrop={(event) => dropPreset(event)}
          >
            {draft.presets.map((instance, index) => (
              <div
                key={instance.id}
                className={`preset-drop-slot [&_+_.preset-drop-slot]:mt-space-3 [&_>_.preset-instance]:mb-0${presetDropBefore === instance.id ? " prompt-drop-before [box-shadow:0_-2px_0_var(--accent)]" : ""}`}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes(presetDragType)) return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "move";
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const after = event.clientY > bounds.top + bounds.height / 2;
                  setPresetDropBefore(
                    after ? (draft.presets[index + 1]?.id ?? "end") : instance.id,
                  );
                }}
                onDrop={(event) =>
                  dropPreset(
                    event,
                    presetDropBefore === "end" ? undefined : (presetDropBefore ?? instance.id),
                  )
                }
              >
                <PresetEditor
                  part="content"
                  instance={instance}
                  dragHandle={
                    <Row
                      gap={0}
                      align="stretch"
                      as="span"
                      className="prompt-drag-handle [&:active]:cursor-grabbing cursor-grab inline-flex shrink-0"
                      draggable
                      title={t("prompt.dragPreset")}
                      aria-label={t("prompt.dragPreset")}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(presetDragType, instance.id);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => setPresetDropBefore(null)}
                    >
                      <GripVertical size={14} aria-hidden />
                    </Row>
                  }
                  resources={resources}
                  models={models}
                  capabilities={capabilities}
                  onPosition={(id) => onPosition(id, instance.id)}
                  characterIssues={outputIssues.presets[instance.id]?.characters}
                  preciseIssues={outputIssues.presets[instance.id]?.precise}
                  vibeIssues={outputIssues.presets[instance.id]?.vibes}
                  onChange={(value) => {
                    const current = readCurrentDraft();
                    if (current)
                      edit({
                        ...current,
                        presets: current.presets.map((item) =>
                          item.id === instance.id ? value : item,
                        ),
                      });
                  }}
                  onRemove={() => {
                    const current = readCurrentDraft();
                    edit({
                      ...current,
                      presets: current.presets.filter((item) => item.id !== instance.id),
                    });
                  }}
                  up={() => {
                    const current = readCurrentDraft();
                    edit({
                      ...current,
                      presets: moveItem(
                        current.presets,
                        current.presets.findIndex((item) => item.id === instance.id),
                        -1,
                      ),
                    });
                  }}
                  down={() => {
                    const current = readCurrentDraft();
                    edit({
                      ...current,
                      presets: moveItem(
                        current.presets,
                        current.presets.findIndex((item) => item.id === instance.id),
                        1,
                      ),
                    });
                  }}
                  canUp={index > 0}
                  canDown={index < draft.presets.length - 1}
                  onError={setError}
                />
              </div>
            ))}
          </div>
        </section>
      )}
      <ImageOperationPanel
        draft={draft}
        capabilities={capabilities}
        estimate={estimate}
        models={models}
        readCurrentDraft={readCurrentDraft}
        edit={edit}
        onRestore={onRestore}
        onError={setError}
        onRequestOperation={onRequestOperation}
        onPrepareImportedOperation={onPrepareImportedOperation}
        onReturnToText={onReturnToText}
        diagnostics={diagnostics}
        errorFields={errorFields}
        inputVersion={imageInputVersion}
        onEditMask={onEditMask}
      />
      {draft.inputs.operation.kind !== "upscale" && (
        <>
          {showPreciseReferences(capabilities, draft.inputs.references.precise.length) && (
            <section className="settings-context reference-context" data-draft-outputs>
              <div data-setting-field="precise">
                <PreciseReferenceEditor
                  value={draft.inputs.references.precise}
                  onChange={(precise) => {
                    const current = readCurrentDraft();
                    edit({
                      ...current,
                      inputs: {
                        ...current.inputs,
                        references: { ...current.inputs.references, precise },
                      },
                    });
                  }}
                  capabilities={capabilities}
                  contextKey={imageInputVersion}
                  issues={outputIssues.draft.precise}
                />
              </div>
            </section>
          )}
          {showVibeReferences(capabilities) && (
            <section className="settings-context reference-context" data-draft-outputs>
              <div data-setting-field="vibes">
                <VibeReferenceEditor
                  value={draft.inputs.references.vibes}
                  normalizeValue={draft.inputs.references.normalizeVibeStrength}
                  onNormalizeChange={(normalizeVibeStrength) => {
                    const current = readCurrentDraft();
                    edit({
                      ...current,
                      inputs: {
                        ...current.inputs,
                        references: { ...current.inputs.references, normalizeVibeStrength },
                      },
                    });
                  }}
                  onChange={(vibes) => {
                    const current = readCurrentDraft();
                    edit({
                      ...current,
                      inputs: {
                        ...current.inputs,
                        references: { ...current.inputs.references, vibes },
                      },
                    });
                  }}
                  capabilities={capabilities}
                  contextKey={imageInputVersion}
                  issues={outputIssues.draft.vibes}
                />
              </div>
            </section>
          )}
          <section className="settings-context">
            <Row
              align="center"
              justify="between"
              gap={3}
              as="header"
              className="flex items-center justify-between gap-space-3 min-w-0 min-h-control mb-space-2 [&_>_:is(h2,_h3)]:m-0 [&_>_:is(h2,_h3)]:min-w-0 [&_>_:is(h2,_h3)]:text-section [&_>_:is(h2,_h3)]:font-semibold"
            >
              <h2>{t("workbench.imageSettings")}</h2>
            </Row>
            <SettingsEditor
              fields="image"
              value={draft.settings}
              models={models}
              capabilities={capabilities}
              diagnostics={diagnostics}
              errorFields={errorFields}
              resolved={resolved?.settings}
              onChange={(settings) => edit({ ...draft, settings })}
            />
            <Grid
              gap={0}
              align="stretch"
              columns={1}
              className="request-count-control [&_>_span]:items-center [&_>_span]:text-muted [&_>_span]:flex [&_>_span]:gap-space-1 grid gap-[5px] mt-space-3 text-caption"
            >
              <span>
                {t("workbench.generationRequests")}{" "}
                <HelpMarker>{t("workbench.requestCountHelp")}</HelpMarker>
              </span>
              <Row
                gap={0}
                align="stretch"
                as="fieldset"
                className="sample-options [&_>_button]:[flex:1_0_28px] [&_>_button]:px-[5px] [&_>_button[aria-pressed=true]]:bg-accent-soft [&_>_button[aria-pressed=true]]:text-accent [&_>_button[aria-pressed=true]]:border-accent [&_.sample-inherit]:[flex:0_0_auto] flex flex-wrap gap-[3px]"
                aria-label={t("workbench.requestCount")}
              >
                {Array.from({ length: 8 }, (_, index) => index + 1).map((count) => (
                  <Button
                    type="button"
                    key={count}
                    aria-pressed={draft.inputs.requestCount === count}
                    onClick={() => {
                      const current = readCurrentDraft();
                      edit({ ...current, inputs: { ...current.inputs, requestCount: count } });
                    }}
                  >
                    {count}
                  </Button>
                ))}
              </Row>
            </Grid>
          </section>
        </>
      )}
    </div>
  );
}
