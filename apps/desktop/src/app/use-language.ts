import { useLayoutEffect } from "react";
import type { Language } from "@/bindings/settings";
import { applyLanguage } from "@/shared/i18n";

/** The preference writer owns storage; i18n only owns the currently displayed language. */
export function useLanguage(preference: Language = "system") {
  useLayoutEffect(() => {
    applyLanguage(preference);

    const update = () => applyLanguage(preference);

    window.addEventListener("languagechange", update);
    return () => window.removeEventListener("languagechange", update);
  }, [preference]);
}
