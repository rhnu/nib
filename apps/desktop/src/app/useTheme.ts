import { useEffect } from "react";
import type { Theme } from "../bindings/settings";
export function useTheme(theme: Theme | undefined) {
  useEffect(() => {
    document.documentElement.dataset.theme = theme ?? "dark";
  }, [theme]);
}
