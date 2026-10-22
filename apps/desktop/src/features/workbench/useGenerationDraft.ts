import { useMemo } from "react";
import type { Draft } from "../../bindings/workbench";

/** Drawing and view changes do not invalidate prompt resolution, capabilities or generation quotes. */
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
    }),
    [composition, presets, settings, characters, inputs],
  );
}
