import { useState, type ReactNode } from "react";
import type { Draft, Resource, ResolvedDraft, WorkspaceSnapshot } from "../../bindings/workbench";
import { Button, Modal, Notice } from "../../shared/ui";
import { errorMessage } from "../../shared/host/error";
import type { CloseWriter } from "../../shared/host/useCloseGuard";
import { ResourceLibrary } from "../library/ResourceLibrary";
import { ContextRail } from "./ContextRail";
import { PromptWorkspace } from "./PromptWorkspace";
import { useWorkbench } from "./useWorkbench";
import { useDraftCapabilities } from "./useDraftCapabilities";
import { useModelCapabilities } from "./useModelCapabilities";
import { useImageOperationRequest } from "./useImageOperationRequest";
import { operationLabel, type ImageOperationAction } from "./image-operation";
import { useGeneration } from "../generation/generation-context";
import { useGenerationQuote } from "../generation/use-generation-quote";
import { isQuoteEligible } from "../generation/quote-state";
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
  operationPending: boolean;
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
    written,
    draft,
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
  const quoteRefreshKey = [resourceVersion, accountVersion];
  const estimate = useGenerationQuote(
    draft,
    quoteRefreshKey,
    !resolving && !accountSummaryLoading && isQuoteEligible(draft, resolved),
  );
  const model = useDraftCapabilities(draft, resourceVersion);
  const generationTarget = useModelCapabilities(
    draft.settings.model ?? resolved?.settings.model ?? workspace.info.defaultModelId,
    resolved?.settings ?? draft.settings,
    draft.inputs.operation.kind === "upscale",
  );
  const editorCapabilities = model.capabilities ?? generationTarget.capabilities;
  const imageOperation = useImageOperationRequest({
    readCurrentDraft,
    edit,
    onError: setError,
    contextVersion: restoreVersion,
  });
  const [page, setPage] = useState<"create" | "settings">(initialPage);
  const extension = {
    draft,
    readCurrentDraft,
    onRestore: restore,
    reportError: setError,
    resourceVersion,
    resolved,
    resolving,
    estimate,
    quoteRefreshKey,
    onImageOperation: imageOperation.request,
    canMaxEnhance: editorCapabilities?.maxEnhance ?? false,
    operationPending: imageOperation.busy,
  };
  return (
    <div className="workbench">
      {renderHeader(
        <nav className="desktop-navigation" aria-label="主导航">
          <Button
            aria-current={!library && page === "create" ? "page" : undefined}
            disabled={library}
            onClick={() => setPage("create")}
          >
            创作
          </Button>
          <Button
            aria-current={library ? "page" : undefined}
            disabled={library}
            onClick={() => openLibrary("positive")}
          >
            资源库
          </Button>
          <Button
            aria-current={!library && page === "settings" ? "page" : undefined}
            disabled={library}
            onClick={() => setPage("settings")}
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
                openLibrary={openLibrary}
                edit={edit}
                setError={setError}
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
              onAddPreset={() => openLibrary("preset")}
              setError={setError}
              estimate={estimate.quote}
              onRestore={restore}
              onRequestOperation={imageOperation.request}
              onReturnToText={imageOperation.returnToText}
              imageInputVersion={restoreVersion}
            />
          </div>
          {renderActions && (
            <div className="generation-actions-slot">{renderActions(extension)}</div>
          )}
        </aside>
        <main className="main-workspace flex min-h-0 min-w-0 flex-col">
          {renderResults?.(extension)}
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
      {imageOperation.busy && (
        <output className="generation-muted image-operation-progress">正在读取图像输入…</output>
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
              。现有源图将替换，不适用的操作专有参数将清除；提示词、配方及其余设置保留。
            </p>
            {imageOperation.candidate.operation.kind === "imageToImage" &&
              imageOperation.candidate.operation.maxEnhance && (
                <p>Max Enhance 将输入画布设为所选源图尺寸，预计输出与计价尺寸由 SDK 计算。</p>
              )}
            <footer className="generation-dialog-actions">
              <Button onClick={imageOperation.cancel}>保留当前操作</Button>
              <Button className="primary" onClick={imageOperation.confirm}>
                应用更改
              </Button>
            </footer>
          </div>
        )}
      </Modal>
    </div>
  );
}
