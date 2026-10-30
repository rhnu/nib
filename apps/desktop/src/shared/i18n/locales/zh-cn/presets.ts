import type { presets as source } from "../en/presets";

export const presets = {
  portrait: "竖图",
  landscape: "横图",
  square: "方图",
  largePortrait: "大尺寸竖图",
  largeLandscape: "大尺寸横图",
} satisfies { [K in keyof typeof source]: string };
