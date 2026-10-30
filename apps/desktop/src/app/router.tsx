import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useBlocker,
} from "@tanstack/react-router";
import type { Draft } from "@/bindings/workbench";
import { CreatePage } from "@/pages/create-page";
import { DirectorPage } from "@/pages/director-page";
import { GalleryPage } from "@/pages/result-panel";
import { LibraryPage } from "@/pages/library-page";
import { PreferencesPage } from "@/pages/preferences-page";
import { useWorkbenchContext } from "@/features/workbench/workbench-context";
import { RecoveryBoundary, RenderFailure } from "@/shared/ui/recovery-boundary";
import { pagePaths, startupPage } from "./navigation";

function RouteOutlet() {
  const { guardNavigation, page } = useWorkbenchContext();
  useBlocker({
    // The same guard covers links, application handoffs, and browser back/forward.
    shouldBlockFn: async ({ current, next }) =>
      current.pathname !== next.pathname && !(await guardNavigation()),
    enableBeforeUnload: false,
  });
  return (
    <RecoveryBoundary label="页面" resetKeys={[page]}>
      <Outlet />
    </RecoveryBoundary>
  );
}

/** Restore the saved page once; after startup, the history owns navigation. */
export function createWorkspaceRouter(savedPage: Draft["activePage"], startupSettings: boolean) {
  const history = createHashHistory();
  const initialPage = startupPage(history.location.pathname, savedPage, startupSettings);
  if (history.location.pathname !== pagePaths[initialPage]) history.replace(pagePaths[initialPage]);
  const root = createRootRoute({ component: RouteOutlet });
  const routeTree = root.addChildren([
    createRoute({ getParentRoute: () => root, path: "/create", component: CreatePage }),
    createRoute({ getParentRoute: () => root, path: "/director", component: DirectorPage }),
    createRoute({ getParentRoute: () => root, path: "/gallery", component: GalleryPage }),
    createRoute({ getParentRoute: () => root, path: "/library", component: LibraryPage }),
    createRoute({ getParentRoute: () => root, path: "/settings", component: PreferencesPage }),
  ]);
  return createRouter({
    routeTree,
    history,
    defaultPreload: false,
    defaultErrorComponent: ({ error, reset }) => (
      <RenderFailure label="页面" error={error} retry={reset} />
    ),
    defaultOnCatch: (error, info) => console.error("页面渲染失败", error, info.componentStack),
  });
}
