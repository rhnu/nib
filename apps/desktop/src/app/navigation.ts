import type { Draft } from "@/bindings/workbench";

export const pagePaths = {
  create: "/create",
  director: "/director",
  gallery: "/gallery",
  explore: "/explore",
  library: "/library",
  lexicon: "/lexicon",
  settings: "/settings",
} as const;

export function pageAtPath(pathname: string): Draft["activePage"] | undefined {
  return (Object.keys(pagePaths) as Draft["activePage"][]).find(
    (page) => pagePaths[page] === pathname,
  );
}

/** Accept the existing hash URL as well as a direct startup page URL. */
export function startupPath(location: { hash: string; pathname: string }) {
  const hashPath = location.hash.slice(1).split(/[?#]/, 1)[0];
  return pageAtPath(hashPath) ? hashPath : location.pathname;
}

/** An explicit startup settings choice wins; otherwise use the URL before the saved snapshot. */
export function startupPage(
  pathname: string,
  savedPage: Draft["activePage"],
  startupSettings: boolean,
) {
  return startupSettings ? "settings" : (pageAtPath(pathname) ?? savedPage);
}
