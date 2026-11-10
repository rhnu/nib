import { RecoveryBoundary, RenderFailure } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";
import {
  createMemoryHistory,
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
import { ExplorePage } from "@/pages/explore-page";
import { LexiconPage } from "@/pages/lexicon-page";
import { PreferencesPage } from "@/pages/preferences-page";
import { useWorkbenchContext } from "@/features/workbench/workbench-context";
import { pagePaths, startupPage, startupPath } from "./navigation";

function RouteOutlet() {
  useTranslation();

  const { guardNavigation, page } = useWorkbenchContext();
  useBlocker({
    // Business navigation keeps the same pending-input and unapplied-mask guard.
    shouldBlockFn: async ({ current, next }) =>
      current.pathname !== next.pathname && !(await guardNavigation()),
    enableBeforeUnload: false,
  });
  return (
    <RecoveryBoundary label={t("app.page")} resetKeys={[page]}>
      <Outlet />
    </RecoveryBoundary>
  );
}

function PageFailure({ error, reset }: { error: unknown; reset: () => void }) {
  useTranslation();
  return <RenderFailure label={t("app.page")} error={error} retry={reset} />;
}

/** Restore the saved page once; after startup, the history owns navigation. */
export function createWorkspaceRouter(savedPage: Draft["activePage"], startupSettings: boolean) {
  const initialPage = startupPage(startupPath(window.location), savedPage, startupSettings);
  const history = createMemoryHistory({ initialEntries: [pagePaths[initialPage]] });
  const root = createRootRoute({ component: RouteOutlet });
  const routeTree = root.addChildren([
    createRoute({ getParentRoute: () => root, path: "/create", component: CreatePage }),
    createRoute({ getParentRoute: () => root, path: "/director", component: DirectorPage }),
    createRoute({ getParentRoute: () => root, path: "/gallery", component: GalleryPage }),
    createRoute({ getParentRoute: () => root, path: "/explore", component: ExplorePage }),
    createRoute({ getParentRoute: () => root, path: "/library", component: LibraryPage }),
    createRoute({ getParentRoute: () => root, path: "/lexicon", component: LexiconPage }),
    createRoute({ getParentRoute: () => root, path: "/settings", component: PreferencesPage }),
  ]);
  return createRouter({
    routeTree,
    history,
    defaultPreload: false,
    defaultErrorComponent: PageFailure,
    defaultOnCatch: (error, info) =>
      console.error("Page render failed", error, info.componentStack),
  });
}
