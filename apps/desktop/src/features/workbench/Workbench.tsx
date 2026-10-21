import { useState, type ReactNode } from "react";
import type { Draft, Resource, WorkspaceSnapshot } from "../../bindings/workbench";
import { Moon, Sun } from "lucide-react";
import { Button, IconButton, Notice } from "../../shared/ui";
import { errorMessage } from "../../shared/host/error";
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
};
export function Workbench({
  workspace,
  initialResources,
  theme,
  toggleTheme,
  renderActions,
  renderResults,
}: {
  workspace: WorkspaceSnapshot;
  initialResources: Map<string, Resource>;
  theme: string;
  toggleTheme: () => void;
  renderActions?: (context: WorkbenchExtension) => ReactNode;
  renderResults?: (context: WorkbenchExtension) => ReactNode;
}) {
  const state = useWorkbench(workspace, initialResources);
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
  const [contextOpen, setContextOpen] = useState(true);
  const extension = {
    draft,
    readCurrentDraft,
    onRestore: restore,
    reportError: setError,
    resourceVersion,
  };
  return (
    <div className="workbench flex h-dvh flex-col overflow-hidden">
      <header className="app-toolbar">
        <div className="app-brand">
          nib
          <span className="brand-divider" />
        </div>
        <span className="editor-label">当前创作</span>
        <span className="spacer" />
        <IconButton
          label={theme === "dark" ? "切换浅色主题" : "切换深色主题"}
          onClick={toggleTheme}
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </IconButton>
      </header>
      {renderActions && <div className="generation-actions-slot">{renderActions(extension)}</div>}
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
      <div className={`workspace-body ${contextOpen ? "" : "context-hidden"}`}>
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
        <main className="main-workspace flex min-h-0 min-w-0 flex-col">
          <PromptWorkspace
            draft={draft}
            resources={resources}
            resolved={resolved}
            resolving={resolving}
            resolveError={resolveError}
            contextOpen={contextOpen}
            toggleContext={() => setContextOpen((value) => !value)}
            openLibrary={openLibrary}
            edit={edit}
            setError={setError}
          />
          {renderResults?.(extension)}
          <footer className="workspace-status">
            <span>
              {resolved?.issues.length
                ? `${resolved.issues.length} 项引用问题`
                : resolveError
                  ? "解析失败"
                  : resolving
                    ? "正在解析组合…"
                    : written.saving
                      ? "正在保存创作…"
                      : written.dirty
                        ? "创作待保存"
                        : "当前创作已保存"}
            </span>
            <span>{workspace.info.version}</span>
          </footer>
        </main>
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
