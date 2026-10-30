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

type WorkspaceShellProps = Omit<WorkbenchControllerOptions, "page" | "navigate"> & {
  startupSettings: boolean;
  renderHeader: (navigation: ReactNode) => ReactNode;
};

const navigationLabels = {
  create: "创作",
  director: "导演工具",
  gallery: "画廊",
  library: "资源库",
  settings: "设置",
} as const;

/** Own editor lifetimes above routed pages and all recoverable render boundaries. */
export function WorkspaceShell(props: WorkspaceShellProps) {
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
    <RecoveryBoundary label="工作台">
      <WorkbenchContext value={controller}>
        <LibrarySessionProvider store={state.librarySession}>
          <MediaToolsContext
            value={{
              onDirector: controller.sendToDirector,
              onPngText: (asset) => controller.afterInputs(() => controller.setPngAsset(asset)),
            }}
          >
            <div className="workbench">
              {props.renderHeader(
                <nav className="desktop-navigation" aria-label="主导航">
                  {(Object.keys(navigationLabels) as Draft["activePage"][]).map((target) => (
                    <Button
                      key={target}
                      disabled={props.readOnly}
                      aria-current={target === page ? "page" : undefined}
                      onClick={() =>
                        target === "library"
                          ? controller.guardedLibrary("positive")
                          : void navigate(target)
                      }
                    >
                      {navigationLabels[target]}
                    </Button>
                  ))}
                </nav>,
              )}
              <div inert={props.readOnly} style={{ display: "contents" }}>
                {error && (
                  <Notice actions={<Button onClick={() => setError("")}>关闭提示</Button>}>
                    {error}
                  </Notice>
                )}
                {resourceError && (
                  <Notice actions={<Button onClick={retryResources}>重试读取资源</Button>}>
                    {resourceError}
                  </Notice>
                )}
                {Boolean(written.error) && (
                  <Notice
                    actions={
                      <Button onClick={() => void writer.flush().catch(() => {})}>重试保存</Button>
                    }
                  >
                    当前创作尚未保存：{errorMessage(written.error)}
                  </Notice>
                )}
                <RouterProvider router={router} />
                <RecoveryBoundary label="操作面板">
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
