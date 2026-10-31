import { t, useTranslation } from "@/shared/i18n";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { RouterProvider } from "@tanstack/react-router";
import type { Draft } from "@/bindings/workbench";
import {
  useWorkbenchController,
  type WorkbenchControllerOptions,
} from "@/features/workbench/use-workbench-controller";
import { WorkbenchContext } from "@/features/workbench/workbench-context";
import { LibrarySessionProvider } from "@/features/library/model/library-session-context";
import { MediaToolsContext } from "@/features/media/media-tools-context";
import { Button, Notice } from "@/shared/ui";
import { RecoveryBoundary } from "@/shared/ui/recovery-boundary";
import { errorMessage } from "@/shared/host/error";
import { WorkspaceDialogs } from "./workspace-dialogs";
import { createWorkspaceRouter } from "./router";
import { pageAtPath, pagePaths } from "./navigation";
import { NavigationIcon } from "./navigation-icon";

type WorkspaceShellProps = Omit<WorkbenchControllerOptions, "page" | "navigate"> & {
  startupSettings: boolean;
  renderHeader: (navigation: ReactNode) => ReactNode;
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

  const controller = useWorkbenchController({ ...props, page, navigate });
  const { state } = controller;
  const { writer, written, error, setError, resourceError, retryResources } = state;
  useEffect(() => {
    const persistPage = () => {
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
  }, [router, writer]);
  return (
    <RecoveryBoundary label={t("app.workspace")}>
      <WorkbenchContext value={controller}>
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
                      disabled={props.readOnly}
                      aria-current={target === page ? "page" : undefined}
                      onClick={() => void navigate(target)}
                    >
                      <NavigationIcon page={target} />
                      {navigationLabels[target]}
                    </Button>
                  ))}
                </nav>,
              )}
              <div inert={props.readOnly} style={{ display: "contents" }}>
                {error && (
                  <Notice
                    actions={<Button onClick={() => setError("")}>{t("app.dismissNotice")}</Button>}
                  >
                    {error}
                  </Notice>
                )}
                {resourceError && (
                  <Notice
                    actions={<Button onClick={retryResources}>{t("app.retryResources")}</Button>}
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
            </div>
          </MediaToolsContext>
        </LibrarySessionProvider>
      </WorkbenchContext>
    </RecoveryBoundary>
  );
}
