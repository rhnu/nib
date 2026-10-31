import { useMemo } from "react";
import type { Draft } from "@/bindings/workbench";

/** Presentation, canvas and independent tool edits do not invalidate resolution or quotes. */
export function useGenerationDraft(draft: Draft): Draft {
  const { composition, presets, settings, characters, inputs } = draft;
  return useMemo(
    () => ({
      composition,
      presets,
      settings,
      characters,
      inputs,
      maskEditor: { activeSourceId: null, sessions: [] },
      vibeEncoder: null,
      director: { selectedTool: "lineart", tools: [] },
      pngTextEditor: { sessions: [] },
      promptEditor: { collapsedBlocks: {} },
      activePage: "create",
    }),
    [composition, presets, settings, characters, inputs],
  );
}
