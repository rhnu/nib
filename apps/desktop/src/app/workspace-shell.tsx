import { t, useTranslation } from "@/shared/i18n";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { Bot } from "lucide-react";
import type { Draft } from "@/bindings/workbench";
import {
  useWorkbenchController,
  type WorkbenchControllerOptions,
} from "@/features/workbench/use-workbench-controller";
import { WorkbenchContext } from "@/features/workbench/workbench-context";
import { LibrarySessionProvider } from "@/features/library/model/library-session-context";
import { MediaToolsContext } from "@/features/media/media-tools-context";
import { Button, IconButton, Notice } from "@/shared/ui";
import { RecoveryBoundary } from "@/shared/ui/recovery-boundary";
import { errorMessage } from "@/shared/host/error";
import { WriteAccessContext } from "@/shared/host/write-access";
import { WorkspaceDialogs } from "./workspace-dialogs";
import { createWorkspaceRouter } from "./router";
import { pageAtPath, pagePaths } from "./navigation";
import { NavigationIcon } from "./navigation-icon";
import { AgentPanel } from "@/features/agent/agent-panel";
import { useAgent } from "@/features/agent/use-agent";

type WorkspaceShellProps = Omit<WorkbenchControllerOptions, "page" | "navigate"> & {
  startupSettings: boolean;
  renderHeader: (navigation: ReactNode, actions: ReactNode) => ReactNode;
};

const navigationLabels = {
  get create() {
    return t("app.create");
  },
  get director() {
    return t("app.directorTools");
  },
  get gallery() {
    return t("app.gallery");
  },
  get explore() {
    return t("explore.title");
  },
  get library() {
    return t("app.library");
  },
  get lexicon() {
    return t("app.lexicon");
  },
  get settings() {
    return t("app.settings");
  },
} as const;

/** Own editor lifetimes above routed pages and all recoverable render boundaries. */
export function WorkspaceShell(props: WorkspaceShellProps) {
  useTranslation();

  const [router] = useState(() =>
    createWorkspaceRouter(props.workspace.draft.activePage, props.startupSettings),
  );

  const subscribe = useCallback(
    (listener: () => void) => router.subscribe("onResolved", listener),
    [router],
  );

  const pathname = useSyncExternalStore(subscribe, () => router.state.location.pathname);
  const page = pageAtPath(pathname) ?? "create";

  const navigate = useCallback(
    async (target: Draft["activePage"], alreadyGuarded = false) => {
      await router.navigate({ to: pagePaths[target], ignoreBlocker: alreadyGuarded });
    },
    [router],
  );

  const [agentLocked, setAgentLocked] = useState(true);
  const [agentOpen, setAgentOpen] = useState(false);

  const closeAgent = useCallback(() => {
    setAgentOpen(false);
    document.getElementById("agent-toggle")?.focus();
  }, []);

  const controller = useWorkbenchController({
    ...props,
    page,
    navigate,
    readOnly: props.readOnly || agentLocked,
  });
  const agent = useAgent({
    controller,
    onLock: setAgentLocked,
    onRunning: () => setAgentOpen(true),
    readOnly: props.readOnly,
  });
  const { state } = controller;
  const { writer, written, error, setError, resourceError, retryResources } = state;
  useEffect(() => {
    const persistPage = () => {
      if (agentLocked) return;
      const activePage = pageAtPath(router.state.location.pathname);
      if (activePage && writer.getSnapshot().value?.activePage !== activePage)
        writer.update((draft) => {
          draft.activePage = activePage;
        });
    };

    const unsubscribe = router.subscribe("onResolved", persistPage);
    // A recovered shell may subscribe after the initial route has already resolved.
    if (router.state.status === "idle" && router.state.resolvedLocation) persistPage();
    return unsubscribe;
  }, [router, writer, agentLocked]);
  return (
    <RecoveryBoundary label={t("app.workspace")}>
      <WorkbenchContext value={controller}>
        <WriteAccessContext
          value={{
            allowed: !props.readOnly && (agent.phase === "ready" || agent.phase === "preparing"),
            canCommit: writer.canEdit,
          }}
        >
          <LibrarySessionProvider store={state.librarySession}>
            <MediaToolsContext
              value={{
                onDirector: controller.sendToDirector,
                onPngText: (asset) => controller.afterInputs(() => controller.setPngAsset(asset)),
                onImageOperation: controller.requestOperation,
                onRestore: controller.guardedRestore,
                canMaxEnhance: controller.extension.canMaxEnhance,
                canInpaint: controller.extension.canInpaint,
              }}
            >
              <div className="workbench">
                {props.renderHeader(
                  <nav className="desktop-navigation" aria-label={t("app.mainNavigation")}>
                    {(Object.keys(navigationLabels) as Draft["activePage"][]).map((target) => (
                      <Button
                        key={target}
                        disabled={props.readOnly || agentLocked}
                        aria-current={target === page ? "page" : undefined}
                        onClick={() => void navigate(target)}
                      >
                        <NavigationIcon page={target} />
                        {navigationLabels[target]}
                      </Button>
                    ))}
                  </nav>,
                  <IconButton
                    id="agent-toggle"
                    className="window-control"
                    label={t("agent.title")}
                    aria-expanded={agentOpen}
                    aria-controls="agent-panel"
                    onClick={() => setAgentOpen((value) => !value)}
                  >
                    <Bot size={17} aria-hidden />
                  </IconButton>,
                )}
                {agentLocked && !agentOpen && (
                  <output className="agent-state">
                    {t(`agent.${agent.phase === "ready" ? "idle" : agent.phase}`)}
                    <Button onClick={() => setAgentOpen(true)}>{t("agent.open")}</Button>
                  </output>
                )}
                <div className="workspace-with-agent">
                  <div inert={props.readOnly || agentLocked} className="workspace-editing-area">
                    {error && (
                      <Notice
                        actions={
                          <Button onClick={() => setError("")}>{t("app.dismissNotice")}</Button>
                        }
                      >
                        {error}
                      </Notice>
                    )}
                    {resourceError && (
                      <Notice
                        actions={
                          <Button onClick={retryResources}>{t("app.retryResources")}</Button>
                        }
                      >
                        {resourceError}
                      </Notice>
                    )}
                    {Boolean(written.error) && (
                      <Notice
                        actions={
                          <Button onClick={() => void writer.flush().catch(() => {})}>
                            {t("app.retrySave")}
                          </Button>
                        }
                      >
                        {t("app.creationUnsaved")}
                        {errorMessage(written.error)}
                      </Notice>
                    )}
                    <RouterProvider router={router} />
                    <RecoveryBoundary label={t("app.operationPanel")}>
                      <WorkspaceDialogs />
                    </RecoveryBoundary>
                  </div>
                  <AgentPanel
                    agent={agent}
                    open={agentOpen}
                    readOnly={props.readOnly}
                    onClose={closeAgent}
                  />
                </div>
              </div>
            </MediaToolsContext>
          </LibrarySessionProvider>
        </WriteAccessContext>
      </WorkbenchContext>
    </RecoveryBoundary>
  );
}
