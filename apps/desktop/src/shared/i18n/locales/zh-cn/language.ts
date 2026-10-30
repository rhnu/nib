import type { language as source } from "../en/language";

export const language = {
  label: "语言",
  system: "跟随系统",
  english: "English",
  simplifiedChinese: "简体中文",
} satisfies { [K in keyof typeof source]: string };
