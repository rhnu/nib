import { useLayoutEffect, useState, type ReactNode } from "react";
import type {
  Draft,
  Resource,
  ResolvedDraft,
  VibeEncodingInput,
  VibeReferenceInput,
  WorkspaceSnapshot,
} from "../../bindings/workbench";
import { Button, Field, Modal, Notice } from "../../shared/ui";
import { errorMessage } from "../../shared/host/error";
import { usePendingWork, waitForPendingWork } from "../../shared/host/pending-work";
import type { CloseWriter } from "../../shared/host/useCloseGuard";
import { ResourceLibrary } from "../library/ResourceLibrary";
import { ContextRail } from "./ContextRail";
import { PromptWorkspace } from "./PromptWorkspace";
import { useWorkbench } from "./useWorkbench";
import { useDraftCapabilities } from "./useDraftCapabilities";
import { useModelCapabilities } from "./useModelCapabilities";
import { useImageOperationRequest } from "./useImageOperationRequest";
import { operationLabel, operationSourceId, type ImageOperationAction } from "./image-operation";
import { useGeneration } from "../generation/generation-context";
import { useGenerationQuote } from "../generation/use-generation-quote";
import { isQuoteEligible } from "../generation/quote-state";
import { useMaskEditor } from "./useMaskEditor";
import { InpaintCanvasWorkspace } from "../inpaint/InpaintCanvasWorkspace";
import { CharacterPositionWorkspace } from "../positioning/CharacterPositionWorkspace";
import { applyCharacterPosition, characterKey, livePositionCharacters } from "../positioning/model";
import { outputIdentity } from "../prompt/output-identity";
import { collectOutputIssues, focusOutputField } from "./output-issues";
import { usePendingInputTransition } from "./usePendingInputTransition";
import { GenerationParameterPanel } from "./GenerationParameterPanel";
import { VibeEncoderPanel } from "../vibes/VibeEncoderPanel";
export type WorkbenchExtension = {
  draft: Draft;
  readCurrentDraft: () => Draft;
  onRestore: (draft: Draft) => void;
  reportError: (message: string) => void;
  resourceVersion: number;
  resolved: ResolvedDraft | null;
  resolving: boolean;
  estimate: ReturnType<typeof useGenerationQuote>;
  quoteRefreshKey: unknown;
  onImageOperation: (id: string, kind: ImageOperationAction) => void;
  canMaxEnhance: boolean;
  canInpaint: boolean;
  operationPending: boolean;
  onFocusField: (field: string) => void;
  onViewedAssetChange: (id: string | null) => void;
  onAddVibeReference: (reference: VibeReferenceInput) => void;
  onEncodeVibe: (input?: VibeEncodingInput) => void;
};
export function Workbench({
  workspace,
  initialResources,
  renderActions,
  renderResults,
  renderHeader,
  settings,
  settingsWriter,
  initialPage = "create",
}: {
  workspace: WorkspaceSnapshot;
  initialResources: Map<string, Resource>;
  renderActions?: (context: WorkbenchExtension) => ReactNode;
  renderResults?: (context: WorkbenchExtension) => ReactNode;
  renderHeader: (navigation: ReactNode) => ReactNode;
  settings: ReactNode;
  settingsWriter: CloseWriter;
  initialPage?: "create" | "settings";
}) {
  const state = useWorkbench(workspace, initialResources, settingsWriter);
  const {
    writer,
    setBeforeClose,
    written,
    draft,
    generationDraft,
    resources,
    resolved,
    resolving,
    resolveError,
    error,
    setError,
    library,
    setLibrary,
    insertTarget,
    setResourceDirty,
    edit,
    restore,
    restoreVersion,
    readCurrentDraft,
    openLibrary,
    insert,
    refreshResources,
    resourceVersion,
  } = state;
  const { accountVersion, accountSummaryLoading } = useGeneration();
  const [positioning, setPositioning] = useState<{ selected: string | null } | null>(null);
  const [viewedAssetId, setViewedAssetId] = useState<string | null>(null);
  const [encoderOpen, setEncoderOpen] = useState(false);
  const quoteRefreshKey = [resourceVersion, accountVersion];
  const estimate = useGenerationQuote(
    generationDraft,
    quoteRefreshKey,
    !resolving && !accountSummaryLoading && isQuoteEligible(draft, resolved),
  );
  const model = useDraftCapabilities(generationDraft, resourceVersion);
  const generationTarget = useModelCapabilities(
    draft.settings.model ?? resolved?.settings.model ?? workspace.info.defaultModelId,
    resolved?.settings ?? draft.settings,
    draft.inputs.operation.kind === "upscale" || positioning !== null,
  );
  const editorCapabilities =
    model.capabilities ??
    (draft.inputs.operation.kind === "upscale" ? generationTarget.capabilities : null);
  const imageOperation = useImageOperationRequest({
    readCurrentDraft,
    edit,
    onError: setError,
    contextVersion: restoreVersion,
  });
  const [page, setPage] = useState<"create" | "settings">(initialPage);
  const mask = useMaskEditor({ draft, readCurrentDraft, edit, onError: setError });
  const pendingInputs = usePendingWork();
  const afterInputs = usePendingInputTransition(setError);
  const guard = (action: () => void) => afterInputs(() => mask.guard(action));
  const openEncoder = (input?: VibeEncodingInput) =>
    afterInputs(() => {
      if (input) edit({ ...readCurrentDraft(), vibeEncoder: input });
      setEncoderOpen(true);
    });
  useLayoutEffect(() => {
    setBeforeClose(async () => {
      await waitForPendingWork();
      return mask.requestClose();
    });
  });
  const editMask = (id: string) => {
    afterInputs(() => {
      imageOperation.cancel();
      setPositioning(null);
      mask.open(id);
    });
  };
  const requestOperation = (id: string, kind: ImageOperationAction) => {
    if (kind === "inpainting") {
      editMask(id);
      setPage("create");
    } else
      guard(() => {
        setPositioning(null);
        imageOperation.request(id, kind);
      });
  };
  const guardedRestore = (value: Draft) =>
    guard(() => {
      setPositioning(null);
      restore(value);
    });
  const guardedLibrary = (target: Parameters<typeof openLibrary>[0]) =>
    guard(() => openLibrary(target));
  const focusField = (field: string) => {
    focusOutputField(field, readCurrentDraft(), resources, resolved);
  };
  const openPositions = (id?: string, instanceId?: string) =>
    guard(() => {
      imageOperation.cancel();
      setPositioning({
        selected: id
          ? characterKey({
              presetInstanceId: instanceId ?? null,
              id: outputIdentity(instanceId ?? null, id),
            })
          : null,
      });
      setPage("create");
    });
  const positionCharacters = livePositionCharacters(draft, resources, resolved?.characters ?? []);
  const positionSize =
    draft.settings.size ?? resolved?.settings.size ?? generationTarget.capabilities?.defaults.size;
  const outputIssues = collectOutputIssues(
    draft,
    resources,
    resolved,
    estimate.quote?.diagnostics ?? [],
    estimate.fields,
  );
  const extension = {
    draft,
    readCurrentDraft,
    onRestore: guardedRestore,
    reportError: setError,
    resourceVersion,
    resolved,
    resolving,
    estimate,
    quoteRefreshKey,
    onFocusField: focusField,
    onViewedAssetChange: setViewedAssetId,
    onEncodeVibe: openEncoder,
    onAddVibeReference: (reference: VibeReferenceInput) => {
      const current = readCurrentDraft();
      edit({
        ...current,
        inputs: {
          ...current.inputs,
          references: {
            ...current.inputs.references,
            vibes: [...current.inputs.references.vibes, reference],
          },
        },
      });
    },
    onImageOperation: requestOperation,
    canMaxEnhance: editorCapabilities?.maxEnhance ?? false,
    canInpaint: editorCapabilities?.inpainting ?? false,
    operationPending:
      pendingInputs > 0 ||
      imageOperation.busy ||
      mask.pending ||
      Boolean(
        mask.active &&
        (mask.active.revision !== mask.active.appliedRevision ||
          draft.inputs.operation.kind !== "inpainting" ||
          draft.inputs.operation.assetId !== mask.active.sourceAssetId ||
          draft.inputs.operation.maskAssetId !== mask.active.appliedMaskAssetId),
      ),
  };
  return (
    <div className="workbench">
      {renderHeader(
        <nav className="desktop-navigation" aria-label="主导航">
          <Button
            aria-current={!library && page === "create" ? "page" : undefined}
            disabled={library}
            onClick={() => {
              if (page !== "create") guard(() => setPage("create"));
            }}
          >
            创作
          </Button>
          <Button
            aria-current={library ? "page" : undefined}
            disabled={library}
            onClick={() => guardedLibrary("positive")}
          >
            资源库
          </Button>
          <Button
            aria-current={!library && page === "settings" ? "page" : undefined}
            disabled={library}
            onClick={() => guard(() => setPage("settings"))}
          >
            设置
          </Button>
        </nav>,
      )}
      {Boolean(error || written.error) && (
        <Notice
          actions={
            <>
              {Boolean(written.error) && (
                <Button onClick={() => void writer.flush().catch(() => {})}>重试保存</Button>
              )}
              {error && (
                <Button className="quiet" onClick={() => setError("")}>
                  关闭提示
                </Button>
              )}
            </>
          }
        >
          {error || errorMessage(written.error)}
        </Notice>
      )}
      <div className="workspace-body" hidden={page !== "create"}>
        <aside className="generation-sidebar" aria-label="生成侧栏">
          <div className="generation-sidebar-scroll">
            {draft.inputs.operation.kind !== "upscale" && (
              <PromptWorkspace
                draft={draft}
                resources={resources}
                models={workspace.models}
                capabilities={model.capabilities}
                diagnostics={estimate.quote?.diagnostics ?? []}
                tokens={estimate.quote?.tokens ?? []}
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
            {model.error && (
              <Notice actions={<Button onClick={model.retry}>重试模型查询</Button>}>
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
              onReturnToText={() => guard(imageOperation.returnToText)}
              onEditMask={editMask}
              imageInputVersion={restoreVersion}
              onPosition={openPositions}
              outputIssues={outputIssues}
              onEncodeVibe={openEncoder}
            />
          </div>
          {draft.inputs.operation.kind !== "upscale" && (
            <GenerationParameterPanel
              value={draft.settings}
              models={workspace.models}
              capabilities={editorCapabilities}
              diagnostics={estimate.quote?.diagnostics ?? []}
              errorFields={estimate.fields}
              resolved={resolved?.settings}
              onChange={(settings) => edit({ ...readCurrentDraft(), settings })}
              advancedContent={
                <div data-setting-field="policy">
                  <Field label="参数校验">
                    <select
                      value={draft.inputs.policy}
                      onChange={(event) => {
                        const current = readCurrentDraft();
                        edit({
                          ...current,
                          inputs: {
                            ...current.inputs,
                            policy: event.target.value === "reject" ? "reject" : "normalize",
                          },
                        });
                      }}
                    >
                      <option value="normalize">自动调整</option>
                      <option value="reject">严格拒绝</option>
                    </select>
                  </Field>
                </div>
              }
            />
          )}
          {renderActions && (
            <div className="generation-actions-slot">{renderActions(extension)}</div>
          )}
        </aside>
        <main className="main-workspace flex min-h-0 min-w-0 flex-col">
          <div
            className="flex min-h-0 min-w-0 flex-1 flex-col"
            style={{ display: mask.active || positioning ? "none" : undefined }}
          >
            {renderResults?.(extension)}
          </div>
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
              <output>正在读取画布设置…</output>
              <Button onClick={() => setPositioning(null)}>返回图像</Button>
            </div>
          )}
        </main>
      </div>
      <div className="settings-page-slot" hidden={page !== "settings"}>
        {settings}
      </div>
      <ResourceLibrary
        open={library}
        onClose={() => setLibrary(false)}
        resources={resources}
        models={workspace.models}
        onChanged={refreshResources}
        onInsert={insert}
        target={insertTarget}
        onDirtyChange={setResourceDirty}
        notice={error || (written.error ? errorMessage(written.error) : "")}
      />
      <Modal
        open={encoderOpen}
        onClose={() => afterInputs(() => setEncoderOpen(false))}
        title="编码 Vibe"
        className="vibe-encoder-modal"
      >
        <VibeEncoderPanel
          draft={draft}
          readCurrentDraft={readCurrentDraft}
          refreshKey={quoteRefreshKey}
          onChange={(vibeEncoder) => edit({ ...readCurrentDraft(), vibeEncoder })}
        />
      </Modal>
      {(imageOperation.busy || pendingInputs > 0) && (
        <output className="generation-muted image-operation-progress">正在准备图像输入…</output>
      )}
      <Modal
        open={imageOperation.candidate !== null}
        onClose={imageOperation.cancel}
        title="更改当前图像操作？"
      >
        {imageOperation.candidate && (
          <div className="generation-dialog-body">
            <p>
              将切换到{operationLabel(imageOperation.candidate.operation)}
              ，替换当前图像操作。
            </p>
            {imageOperation.candidate.operation.kind === "imageToImage" &&
              imageOperation.candidate.operation.maxEnhance && <p>输入尺寸将采用源图尺寸。</p>}
            <footer className="generation-dialog-actions">
              <Button onClick={imageOperation.cancel}>保留当前操作</Button>
              <Button className="primary" onClick={() => afterInputs(imageOperation.confirm)}>
                应用更改
              </Button>
            </footer>
          </div>
        )}
      </Modal>
      <Modal open={mask.transition !== null} onClose={mask.cancel} title="遮罩尚未应用">
        <div className="generation-dialog-body">
          <p>保留编辑可在下次打开这张源图时继续。</p>
          <footer className="generation-dialog-actions">
            <Button disabled={mask.pending} onClick={mask.cancel}>
              取消
            </Button>
            <Button disabled={mask.pending} onClick={mask.discardAndContinue}>
              放弃编辑
            </Button>
            <Button disabled={mask.pending} onClick={mask.keep}>
              保留编辑
            </Button>
            <Button
              className="primary"
              disabled={mask.pending}
              onClick={() => {
                void mask.applyAndContinue();
              }}
            >
              {mask.pending ? "正在应用…" : "应用遮罩"}
            </Button>
          </footer>
        </div>
      </Modal>
      <Modal
        open={mask.applyConfirmation !== null}
        onClose={() => mask.confirmApply(false)}
        title="切换为局部重绘？"
      >
        <div className="generation-dialog-body">
          <p>
            将替换当前{mask.applyConfirmation && operationLabel(mask.applyConfirmation.operation)}
            {mask.applyConfirmation &&
            operationSourceId(mask.applyConfirmation.operation) !== mask.active?.sourceAssetId
              ? "的源图与专有参数。"
              : "的专有参数。"}
          </p>
          <footer className="generation-dialog-actions">
            <Button onClick={() => mask.confirmApply(false)}>取消</Button>
            <Button className="primary" onClick={() => mask.confirmApply(true)}>
              应用遮罩并切换
            </Button>
          </footer>
        </div>
      </Modal>
      <Modal open={mask.discarding} onClose={mask.cancelDiscard} title="放弃未应用的遮罩编辑？">
        <div className="generation-dialog-body">
          <footer className="generation-dialog-actions">
            <Button onClick={mask.cancelDiscard}>取消</Button>
            <Button className="primary" onClick={mask.confirmDiscard}>
              放弃编辑
            </Button>
          </footer>
        </div>
      </Modal>
    </div>
  );
}
