import { Button, Field, Notice, Select, Row, Col, RecoveryBoundary } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";
import { useState } from "react";

import { PromptWorkspace } from "@/features/workbench/prompt-workspace";
import { CharacterContext } from "@/features/workbench/character-context";
import { ContextRail } from "@/features/workbench/context-rail";
import { GenerationParameterPanel } from "@/features/workbench/generation-parameter-panel";
import { InpaintCanvasWorkspace } from "@/features/inpaint/inpaint-canvas-workspace";
import { CharacterPositionWorkspace } from "@/features/positioning/character-position-workspace";
import { applyCharacterPosition } from "@/features/positioning/model";
import { operationSourceId } from "@/features/inputs/image-operation";
import { GenerationActions, StreamModeSelect } from "@/features/generation";
import { useWorkbenchContext } from "@/features/workbench/workbench-context";
import { PromptTransferProvider } from "@/features/prompt/prompt-transfer-context";
import { transferPromptNode } from "@/features/prompt/prompt-transfer";
import { promptBlockKey } from "@/features/prompt/prompt-editor-collapse";
import { PromptEditorStateProvider } from "@/features/prompt/prompt-editor-state";
import { PromptFormattingProvider } from "@/features/prompt/format-context";
import { ResourcePicker } from "@/features/library/resource-picker";
import { useImageDrop } from "@/features/media/use-image-drop";
import { ImageImportDialog } from "@/features/media/image-import-dialog";
import type { MediaAsset } from "@/bindings/media";
import { ResultPanel } from "./result-panel";

export function CreatePage() {
  useTranslation();
  const [presetPickerOpen, setPresetPickerOpen] = useState(false);
  const [droppedImage, setDroppedImage] = useState<{ asset: MediaAsset; version: number } | null>(
    null,
  );

  const {
    state,
    workspace,
    model,
    editorCapabilities,
    estimate,
    focusField,
    openPositions,
    outputIssues,
    guardedRestore,
    requestOperation,
    prepareImportedOperation,
    addImageReference,
    encodeImage,
    importMetadata,
    guard,
    imageOperation,
    editMask,
    extension,
    mask,
    positioning,
    positionSize,
    positionCharacters,
    generationTarget,
    viewedAssetId,
    setPositioning,
    quoteRefreshKey,
  } = useWorkbenchContext();
  const {
    draft,
    resources,
    resolved,
    resolving,
    resolveError,
    edit,
    setError,
    readCurrentDraft,
    restoreVersion,
  } = state;
  const dropped = droppedImage?.version === restoreVersion ? droppedImage.asset : null;
  const drop = useImageDrop({
    onImported: (asset) => setDroppedImage({ asset, version: restoreVersion }),
    contextKey: JSON.stringify([
      restoreVersion,
      draft.inputs.operation.kind,
      operationSourceId(draft.inputs.operation),
      draft.settings.model ?? resolved?.settings.model,
    ]),
  });
  const tokenStatus =
    resolveError ||
    estimate.error ||
    (estimate.loadingIndicator
      ? t(estimate.displayQuote ? "prompt.updating" : "prompt.countingTokens")
      : !estimate.refreshing && !estimate.displayQuote
        ? t("prompt.tokenUsageUnavailable")
        : undefined);
  return (
    <PromptFormattingProvider readDraft={readCurrentDraft} resources={resources}>
      <PromptTransferProvider
        onMove={(from, to, nodeId, beforeId) => {
          state.writer.update((current) => {
            const next = transferPromptNode(current, from, to, nodeId, beforeId);
            if (!next) return;
            current.composition = next.composition;
            current.characters = next.characters;
            current.presets = next.presets;
            const oldKey = promptBlockKey([...from.path, from.scope], nodeId);
            const newKey = promptBlockKey([...to.path, to.scope], nodeId);
            const collapsed = current.promptEditor.collapsedBlocks[oldKey];
            if (collapsed !== undefined && oldKey !== newKey) {
              current.promptEditor.collapsedBlocks[newKey] = collapsed;
              delete current.promptEditor.collapsedBlocks[oldKey];
            }
          });
        }}
      >
        <PromptEditorStateProvider
          state={draft.promptEditor}
          onCollapsedChange={(key, collapsed) =>
            state.writer.update((current) => {
              current.promptEditor.collapsedBlocks[key] = collapsed;
            })
          }
        >
          {presetPickerOpen && (
            <ResourcePicker
              kind="preset"
              model={
                model.capabilities?.model ??
                resolved?.settings.model ??
                draft.settings.model ??
                undefined
              }
              contextLabel={`${t("prompt.currentCreation")} · ${t("workbench.presets")}`}
              onClose={() => setPresetPickerOpen(false)}
              onChoose={(resource) => {
                state.insertPreset(resource);
                setPresetPickerOpen(false);
              }}
            />
          )}
          <Row
            gap={0}
            align="stretch"
            className="workspace-body grid grid-cols-[var(--sidebar-width)_minmax(0,_1fr)] flex-1 min-h-0 overflow-hidden max-[760px]:grid-cols-[minmax(0,_1fr)] max-[760px]:overflow-auto max-[760px]:content-start image-drop-page relative"
            {...drop.bindings}
          >
            {(drop.dragging || drop.busy) && (
              <output className="page-image-drop absolute inset-[8px] z-20 grid place-content-center [border:2px_dashed_var(--accent)] rounded-control bg-accent-soft text-foreground font-semibold pointer-events-none">
                {t(drop.busy ? "media.importing" : "media.dropHere")}
              </output>
            )}
            {drop.error && (
              <div className="page-image-drop-error absolute top-[8px] right-[12px] z-21 max-w-[420px]">
                <Notice actions={<Button onClick={drop.clearError}>{t("common.close")}</Button>}>
                  {drop.error}
                </Notice>
              </div>
            )}
            {dropped && (
              <ImageImportDialog
                key={dropped.id}
                asset={dropped}
                capabilities={editorCapabilities}
                onClose={() => setDroppedImage(null)}
                onSource={() => requestOperation(dropped.id, "imageToImage")}
                onReference={(kind) => addImageReference(dropped.id, kind)}
                onEncode={() => encodeImage(dropped.id)}
                onImportMetadata={importMetadata}
                onVibes={(values, mode) => {
                  const current = readCurrentDraft();
                  edit({
                    ...current,
                    inputs: {
                      ...current.inputs,
                      references: {
                        ...current.inputs.references,
                        vibes:
                          mode === "replace"
                            ? values
                            : [...current.inputs.references.vibes, ...values],
                      },
                    },
                  });
                }}
              />
            )}

            <Col
              gap={0}
              as="aside"
              className="generation-sidebar flex flex-col min-w-0 min-h-0 [border-right:1px_solid_var(--line)] bg-panel max-[760px]:min-h-[min(640px,_calc(100dvh_-_var(--titlebar-height)))] max-[760px]:[border-right:0] max-[760px]:[border-bottom:1px_solid_var(--line)]"
              aria-label={t("workbench.generationSidebar")}
            >
              <div className="generation-sidebar-scroll flex-1 min-h-0 overflow-auto [scrollbar-gutter:stable] [overscroll-behavior:contain] max-[760px]:overflow-visible">
                {draft.inputs.operation.kind !== "upscale" && (
                  <PromptWorkspace
                    draft={draft}
                    resources={resources}
                    models={workspace.models}
                    capabilities={model.capabilities}
                    diagnostics={estimate.quote?.diagnostics ?? []}
                    tokens={estimate.displayQuote?.tokens ?? []}
                    tokenStatus={tokenStatus}
                    tokensPending={resolving || estimate.refreshing}
                    errorFields={estimate.fields}
                    resolved={resolved}
                    resolving={resolving}
                    resolveError={resolveError}
                    readCurrentDraft={readCurrentDraft}
                    edit={edit}
                    setError={setError}
                    onFocusField={focusField}
                  />
                )}
                {draft.inputs.operation.kind !== "upscale" && (
                  <CharacterContext
                    draft={draft}
                    resources={resources}
                    models={workspace.models}
                    resolved={resolved}
                    capabilities={editorCapabilities}
                    readCurrentDraft={readCurrentDraft}
                    edit={edit}
                    setError={setError}
                    onPosition={openPositions}
                    outputIssues={outputIssues}
                    inheritedUseCoords={estimate.quote?.resolved?.settings.useCoords}
                    quote={estimate.displayQuote}
                    tokenStatus={tokenStatus}
                    tokensPending={resolving || estimate.refreshing}
                  />
                )}
                {model.error && (
                  <Notice
                    actions={
                      <Button onClick={model.retry}>{t("workbench.retryModelQuery")}</Button>
                    }
                  >
                    {model.error}
                  </Notice>
                )}
                <ContextRail
                  draft={draft}
                  resources={resources}
                  models={workspace.models}
                  resolved={resolved}
                  capabilities={editorCapabilities}
                  diagnostics={estimate.quote?.diagnostics ?? []}
                  errorFields={estimate.fields}
                  readCurrentDraft={readCurrentDraft}
                  edit={edit}
                  onAddPreset={() => setPresetPickerOpen(true)}
                  setError={setError}
                  estimate={estimate.quote}
                  onRestore={guardedRestore}
                  onRequestOperation={requestOperation}
                  onPrepareImportedOperation={prepareImportedOperation}
                  onReturnToText={() => guard(imageOperation.returnToText)}
                  onEditMask={editMask}
                  imageInputVersion={restoreVersion}
                  onPosition={openPositions}
                  outputIssues={outputIssues}
                />
              </div>
              <div className="generation-actions-slot shrink-0 p-[8px_12px] [border-top:1px_solid_var(--line-subtle)] bg-panel">
                <GenerationActions
                  draft={draft}
                  readCurrentDraft={readCurrentDraft}
                  refreshKey={quoteRefreshKey}
                  estimate={estimate}
                  operationPending={extension.operationPending}
                  onFocusField={focusField}
                  parameters={
                    draft.inputs.operation.kind !== "upscale" && (
                      <GenerationParameterPanel
                        value={draft.settings}
                        models={workspace.models}
                        capabilities={editorCapabilities}
                        diagnostics={estimate.quote?.diagnostics ?? []}
                        errorFields={estimate.fields}
                        resolved={resolved?.settings}
                        onChange={(settings) => edit({ ...readCurrentDraft(), settings })}
                        advancedContent={
                          <>
                            <StreamModeSelect
                              value={draft.inputs.stream}
                              supported={editorCapabilities?.streaming ?? null}
                              modes={editorCapabilities?.streamModes ?? null}
                              onChange={(stream) => {
                                const current = readCurrentDraft();
                                edit({ ...current, inputs: { ...current.inputs, stream } });
                              }}
                            />
                            <div data-setting-field="policy">
                              <Field label={t("workbench.parameterValidation")}>
                                <Select
                                  value={draft.inputs.policy}
                                  aria-label={t("workbench.parameterValidation")}
                                  onValueChange={(policy) => {
                                    const current = readCurrentDraft();
                                    edit({
                                      ...current,
                                      inputs: {
                                        ...current.inputs,
                                        policy: policy === "reject" ? "reject" : "normalize",
                                      },
                                    });
                                  }}
                                  options={[
                                    { value: "normalize", label: t("workbench.autoAdjust") },
                                    { value: "reject", label: t("workbench.strictReject") },
                                  ]}
                                />
                              </Field>
                            </div>
                          </>
                        }
                      />
                    )
                  }
                />
              </div>
            </Col>
            <Col
              gap={0}
              as="main"
              className="main-workspace flex min-h-0 min-w-0 flex-col max-[760px]:min-h-[440px]"
            >
              <Col
                gap={0}
                className="min-h-0 min-w-0 flex-1"
                hidden={Boolean(mask.active || positioning)}
              >
                <ResultPanel />
              </Col>
              <RecoveryBoundary
                label={t("workbench.canvas")}
                resetKeys={[mask.active?.sourceAssetId, Boolean(positioning)]}
              >
                {mask.active && (
                  <InpaintCanvasWorkspace
                    key={mask.active.sourceAssetId}
                    value={mask.active}
                    onChange={mask.change}
                    onApply={() => {
                      void mask.apply();
                    }}
                    onClose={mask.close}
                    onDiscard={mask.requestDiscard}
                    pending={mask.pending || mask.transition !== null || mask.discarding}
                  />
                )}
                {positioning && !mask.active && positionSize && (
                  <CharacterPositionWorkspace
                    characters={positionCharacters}
                    capabilities={model.capabilities ?? generationTarget.capabilities}
                    size={positionSize}
                    sourceId={operationSourceId(draft.inputs.operation) ?? viewedAssetId}
                    selectedKey={positioning.selected}
                    onSelect={(selected) => setPositioning({ selected })}
                    onChange={(character, position) => {
                      const current = readCurrentDraft();
                      const next = applyCharacterPosition(current, resources, character, position);
                      if (next !== current) edit(next);
                    }}
                    useCoords={draft.settings.useCoords}
                    effectiveUseCoords={
                      estimate.quote?.resolved?.settings.useCoords ?? resolved?.settings.useCoords
                    }
                    onModeChange={(useCoords) => {
                      const current = readCurrentDraft();
                      edit({ ...current, settings: { ...current.settings, useCoords } });
                    }}
                    onClose={() => setPositioning(null)}
                  />
                )}
                {positioning && !mask.active && !positionSize && (
                  <div>
                    <output>{t("workbench.loadingCanvasSettings")}</output>
                    <Button onClick={() => setPositioning(null)}>
                      {t("workbench.backToImage")}
                    </Button>
                  </div>
                )}
              </RecoveryBoundary>
            </Col>
          </Row>
        </PromptEditorStateProvider>
      </PromptTransferProvider>
    </PromptFormattingProvider>
  );
}
