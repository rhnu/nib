import type { Draft } from "@/bindings/workbench";

export const pagePaths = {
  create: "/create",
  director: "/director",
  gallery: "/gallery",
  library: "/library",
  settings: "/settings",
} as const;

export function pageAtPath(pathname: string): Draft["activePage"] | undefined {
  return (Object.keys(pagePaths) as Draft["activePage"][]).find(
    (page) => pagePaths[page] === pathname,
  );
}

/** An explicit startup settings choice wins; otherwise use the URL before the saved snapshot. */
export function startupPage(
  pathname: string,
  savedPage: Draft["activePage"],
  startupSettings: boolean,
) {
  return startupSettings ? "settings" : (pageAtPath(pathname) ?? savedPage);
}
