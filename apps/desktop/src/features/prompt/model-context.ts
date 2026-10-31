import type { Draft } from "@/bindings/workbench";

/** Only edits that may select a different model invalidate retained model-specific displays. */
export function promptModelContext(draft: Draft): string {
  return JSON.stringify([
    draft.settings.model,
    draft.inputs.operation.kind,
    draft.presets.map((preset) => [
      preset.enabled,
      preset.binding.kind === "linked"
        ? [preset.binding.resourceId, preset.binding.settingsOverrides.model]
        : preset.binding.defaults.model,
    ]),
  ]);
}
