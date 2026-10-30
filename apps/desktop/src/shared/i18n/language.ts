import type { Language } from "@/bindings/settings";

export type ResolvedLanguage = "en" | "zh-CN";

/** Match the user's supported language preferences without treating Traditional Chinese as Simplified. */
export function resolveLanguage(
  preference: Language,
  languages: readonly string[],
): ResolvedLanguage {
  if (preference !== "system") return preference;
  for (const language of languages) {
    try {
      const locale = new Intl.Locale(language);
      if (locale.language === "en") return "en";
      if (
        locale.language === "zh" &&
        locale.script !== "Hant" &&
        (locale.script === "Hans" || !locale.region || ["CN", "SG"].includes(locale.region))
      )
        return "zh-CN";
    } catch {
      // Browser language lists are external input; skip invalid tags.
    }
  }
  return "en";
}
