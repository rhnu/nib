import { t, useTranslation } from "@/shared/i18n";
import { Button, Field, Notice, Select } from "@/shared/ui";
import { RecoveryBoundary } from "@/shared/ui/recovery-boundary";
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
import { ResultPanel } from "./result-panel";

export function CreatePage() {
  useTranslation();

  const {
    state,
    workspace,
    model,
    editorCapabilities,
    estimate,
    guardedLibrary,
    focusField,
    openPositions,
    outputIssues,
    guardedRestore,
    requestOperation,
    prepareImportedOperation,
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
  const tokenStatus =
    resolveError ||
    estimate.error ||
    (estimate.loadingIndicator
      ? t(estimate.displayQuote ? "prompt.updating" : "prompt.countingTokens")
      : !estimate.refreshing && !estimate.displayQuote
        ? t("prompt.tokenUsageUnavailable")
        : undefined);
  return (
    <div className="workspace-body">
      <aside className="generation-sidebar" aria-label={t("workbench.generationSidebar")}>
        <div className="generation-sidebar-scroll">
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
              openLibrary={guardedLibrary}
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
              actions={<Button onClick={model.retry}>{t("workbench.retryModelQuery")}</Button>}
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
            onAddPreset={() => guardedLibrary("preset")}
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
        <div className="generation-actions-slot">
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
      </aside>
      <main className="main-workspace flex min-h-0 min-w-0 flex-col">
        <div
          className="flex min-h-0 min-w-0 flex-1 flex-col"
          style={{ display: mask.active || positioning ? "none" : undefined }}
        >
          <ResultPanel />
        </div>
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
              <Button onClick={() => setPositioning(null)}>{t("workbench.backToImage")}</Button>
            </div>
          )}
        </RecoveryBoundary>
      </main>
    </div>
  );
}
