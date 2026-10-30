import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import type { Language } from "@/bindings/settings";
import { en } from "./locales/en";
import { zhCN } from "./locales/zh-cn";
import { resolveLanguage } from "./language";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    returnNull: false;
    strictKeyChecks: true;
    enableSelector: false;
    resources: { translation: typeof en };
  }
}

const systemLanguages = () => (typeof navigator === "undefined" ? [] : navigator.languages);

// Both catalogs are bundled so startup, root errors, and offline use have no loading dependency.
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, "zh-CN": { translation: zhCN } },
  lng: resolveLanguage("system", systemLanguages()),
  fallbackLng: "en",
  supportedLngs: ["en", "zh-CN"],
  initAsync: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export const t = i18n.t.bind(i18n);

export function applyLanguage(preference: Language) {
  const language = resolveLanguage(preference, systemLanguages());
  if (i18n.resolvedLanguage !== language) void i18n.changeLanguage(language);
  if (typeof document !== "undefined") document.documentElement.lang = language;
}

applyLanguage("system");

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(i18n.resolvedLanguage, options).format(value);
}

export function formatDate(value: number | Date, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(
    i18n.resolvedLanguage,
    options ?? {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    },
  ).format(value);
}

export { i18n };
