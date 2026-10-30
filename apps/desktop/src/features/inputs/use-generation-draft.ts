import { useMemo } from "react";
import type { Draft } from "@/bindings/workbench";

/** Canvas and independent encoding edits do not invalidate generation resolution or quotes. */
export function useGenerationDraft(draft: Draft): Draft {
  const { composition, presets, settings, characters, inputs } = draft;
  return useMemo(
    () => ({
      revision: 0,
      composition,
      presets,
      settings,
      characters,
      inputs,
      maskEditor: { activeSourceId: null, sessions: [] },
      vibeEncoder: null,
      director: { selectedTool: "lineart", tools: [] },
      pngTextEditor: { sessions: [] },
      activePage: "create",
    }),
    [composition, presets, settings, characters, inputs],
  );
}
