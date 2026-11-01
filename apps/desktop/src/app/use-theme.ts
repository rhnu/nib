import { useLayoutEffect } from "react";
import type { Theme } from "@/bindings/settings";

export function useTheme(theme: Theme | undefined) {
  useLayoutEffect(() => {
    // Keep the host's initial theme until the authoritative preferences have loaded.
    if (theme) document.documentElement.dataset.theme = theme;
  }, [theme]);
}
