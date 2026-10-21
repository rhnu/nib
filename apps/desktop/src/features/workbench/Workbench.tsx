import { useState, type ReactNode } from "react";
import type { Draft, Resource, ResolvedDraft, WorkspaceSnapshot } from "../../bindings/workbench";
import { Button, Notice } from "../../shared/ui";
import { errorMessage } from "../../shared/host/error";
import type { CloseWriter } from "../../shared/host/useCloseGuard";
import { ResourceLibrary } from "../library/ResourceLibrary";
import { ContextRail } from "./ContextRail";
import { PromptWorkspace } from "./PromptWorkspace";
import { useWorkbench } from "./useWorkbench";
export type WorkbenchExtension = {
  draft: Draft;
  readCurrentDraft: () => Draft;
  onRestore: (draft: Draft) => void;
  reportError: (message: string) => void;
  resourceVersion: number;
  resolved: ResolvedDraft | null;
  resolving: boolean;
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
    readCurrentDraft,
    openLibrary,
    insert,
    refreshResources,
    resourceVersion,
  } = state;
  const [page, setPage] = useState<"create" | "settings">(initialPage);
  const extension = {
    draft,
    readCurrentDraft,
    onRestore: restore,
    reportError: setError,
    resourceVersion,
    resolved,
    resolving,
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
            <PromptWorkspace
              draft={draft}
              resources={resources}
              models={workspace.models}
              resolved={resolved}
              resolving={resolving}
              resolveError={resolveError}
              openLibrary={openLibrary}
              edit={edit}
              setError={setError}
            />
            <ContextRail
              draft={draft}
              resources={resources}
              models={workspace.models}
              resolved={resolved}
              readCurrentDraft={readCurrentDraft}
              edit={edit}
              onAddPreset={() => openLibrary("preset")}
              setError={setError}
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
    </div>
  );
}
