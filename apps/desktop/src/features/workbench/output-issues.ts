import type { Draft, Resource, ResolvedDraft } from "../../bindings/workbench";
import type { ParameterDiagnostic } from "../../bindings/generation";
import { characterDefinition } from "../positioning/model";
import { focusSetting } from "../prompt/settings";
import { outputIdentity } from "../prompt/output-identity";

export type OutputFieldIssue = { field: string; message: string };
export type OutputIssues = {
  characters: Record<string, OutputFieldIssue[]>;
  precise: Record<string, OutputFieldIssue[]>;
  vibes: Record<string, OutputFieldIssue[]>;
};
export type ScopedOutputIssues = { draft: OutputIssues; presets: Record<string, OutputIssues> };
const empty = (): OutputIssues => ({ characters: {}, precise: {}, vibes: {} });
type Target = {
  kind: "character" | "reference" | "vibe";
  id: string;
  presetInstanceId: string | null;
  field?: string;
  scope?: string | null;
  nodeId?: string | null;
};

export function outputTarget(
  field: string,
  resolved: ResolvedDraft | null,
  draft: Draft,
  resources: Map<string, Resource>,
): Target | null {
  const characterMatch = /^(?:characters\.)?characters\[(\d+)\](?:\.(.*))?$/.exec(field);
  if (characterMatch) {
    const character = resolved?.characters[Number(characterMatch[1])];
    if (!character) return null;
    const source = characterDefinition(draft, resources, character);
    if (!source) return null;
    const tail = characterMatch[2] ?? "entry";
    return {
      kind: "character",
      id: source.id,
      presetInstanceId: character.presetInstanceId,
      field:
        tail === "prompt"
          ? "positive"
          : /negative_?prompt/i.test(tail)
            ? "negative"
            : tail.split(".").at(-1),
    };
  }
  const preciseMatch = /^references\.character_references\[(\d+)\](?:\.(.*))?$/.exec(field);
  const vibeMatch = /^references\.vibe_transfer\.references\[(\d+)\](?:\.(.*))?$/.exec(field);
  const referenceMatch = preciseMatch ?? vibeMatch;
  const referenceKind = preciseMatch ? "precise" : "vibes";
  if (referenceMatch) {
    const reference = resolved?.inputs.references[referenceKind].filter((item) => item.enabled)[
      Number(referenceMatch[1])
    ];
    if (!reference) return null;
    const source = resolved?.inputSources.find((item) => item.id === reference.id);
    const instance = draft.presets.find((item) => item.id === source?.presetInstanceId);
    const binding = instance?.binding;
    const resource = binding?.kind === "linked" ? resources.get(binding.resourceId) : null;
    const definitions =
      binding?.kind === "expanded"
        ? binding.references[referenceKind]
        : resource?.content.kind === "preset"
          ? resource.content.references[referenceKind]
          : draft.inputs.references[referenceKind];
    const definition = definitions.find(
      (item) => outputIdentity(instance?.id ?? null, item.id) === reference.id,
    );
    if (!definition) return null;
    const tail = referenceMatch[2] ?? "entry";
    return {
      kind: preciseMatch ? "reference" : "vibe",
      id: definition.id,
      presetInstanceId: source?.presetInstanceId ?? null,
      field:
        tail === "information_extracted" || tail === "input.information_extracted"
          ? "informationExtracted"
          : tail.startsWith("input")
            ? "input"
            : tail === "image"
              ? "assetId"
              : tail,
    };
  }
  return null;
}

export function collectOutputIssues(
  draft: Draft,
  resources: Map<string, Resource>,
  resolved: ResolvedDraft | null,
  diagnostics: ParameterDiagnostic[],
  rejected: string[],
): ScopedOutputIssues {
  const result: ScopedOutputIssues = { draft: empty(), presets: {} };
  for (const issue of [
    ...diagnostics.map((item) => ({ field: item.field, message: item.change })),
    ...rejected.map((field) => ({ field, message: "此项未通过校验。" })),
  ]) {
    const target = outputTarget(issue.field, resolved, draft, resources);
    if (!target) continue;
    const scope = target.presetInstanceId
      ? (result.presets[target.presetInstanceId] ??= empty())
      : result.draft;
    const group =
      target.kind === "character"
        ? scope.characters
        : target.kind === "vibe"
          ? scope.vibes
          : scope.precise;
    (group[target.id] ??= []).push({ field: target.field ?? "entry", message: issue.message });
  }
  return result;
}

/** Reveal the exact owning instance and its collapsed field before focusing. */
export function focusOutputField(
  field: string,
  draft: Draft,
  resources: Map<string, Resource>,
  resolved: ResolvedDraft | null,
): boolean {
  const collection =
    field === "characters"
      ? "characters"
      : field === "references.character_references"
        ? "precise"
        : field === "references.vibe_transfer" || field === "references.vibe_transfer.references"
          ? "vibes"
          : null;
  if (collection) {
    const group = document.querySelector<HTMLElement>(
      `[data-draft-outputs][data-setting-field="${collection}"], [data-draft-outputs] [data-setting-field="${collection}"]`,
    );
    if (!group) return false;
    for (let parent = group.parentElement; parent; parent = parent.parentElement)
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    group.scrollIntoView({ block: "nearest" });
    group
      .querySelector<HTMLElement>(
        "input:not(:disabled), select:not(:disabled), button:not(:disabled)",
      )
      ?.focus();
    return true;
  }
  let target = outputTarget(field, resolved, draft, resources);
  for (const kind of ["character", "reference", "vibe"] as const) {
    if (!field.startsWith(`${kind}:`)) continue;
    try {
      target = { ...JSON.parse(field.slice(kind.length + 1)), kind } as Target;
    } catch {
      return false;
    }
  }
  if (!target) return focusSetting(field);
  const selected = target;
  const scopes = document.querySelectorAll(
    target.presetInstanceId
      ? `[data-preset-instance-id="${CSS.escape(target.presetInstanceId)}"]`
      : "[data-draft-outputs]",
  );
  const scope = [...scopes].find((candidate) =>
    candidate.querySelector(`[data-${selected.kind}-id="${CSS.escape(selected.id)}"]`),
  );
  const row = scope?.querySelector<HTMLElement>(
    `[data-${selected.kind}-id="${CSS.escape(selected.id)}"]`,
  );
  if (!row) return false;
  row.querySelector<HTMLElement>('[data-character-expand][aria-expanded="false"]')?.click();
  for (let element: HTMLElement | null = row; element; element = element.parentElement)
    if (element instanceof HTMLDetailsElement) element.open = true;
  const textScope =
    target.scope ??
    (target.field === "positive" || target.field === "negative" ? target.field : null);
  if (target.kind === "character" && (textScope || target.nodeId)) {
    const prompts = row.querySelector<HTMLDetailsElement>(".character-prompts");
    if (prompts) prompts.open = true;
  }
  // Choose the scope before looking for a node: inactive tab panels may be unmounted.
  if (textScope)
    row.querySelector<HTMLElement>(`[data-prompt-tab="${CSS.escape(textScope)}"]`)?.click();
  requestAnimationFrame(() => {
    if (!row.isConnected) return;
    const promptScope = textScope
      ? row.querySelector<HTMLElement>(`[data-prompt-scope="${CSS.escape(textScope)}"]`)
      : null;
    const container = selected.nodeId
      ? ((promptScope ?? row).querySelector<HTMLElement>(
          `[data-prompt-node-id="${CSS.escape(selected.nodeId)}"]`,
        ) ??
        scope?.querySelector<HTMLElement>(
          `[data-prompt-node-id="${CSS.escape(selected.nodeId)}"]`,
        ) ??
        promptScope ??
        row)
      : (promptScope ?? row);
    const control = selected.field
      ? container.querySelector<HTMLElement>(
          `[data-${selected.kind}-field="${CSS.escape(selected.field)}"]`,
        )
      : null;
    const fieldContainer = control ?? container;
    const focus = fieldContainer.matches("textarea, input, select, button")
      ? fieldContainer
      : (fieldContainer.querySelector<HTMLElement>("textarea, input:not([type='range']), select") ??
        fieldContainer.querySelector<HTMLElement>("button[aria-invalid='true'], button"));
    for (
      let parent: HTMLElement | null = focus ?? fieldContainer;
      parent;
      parent = parent.parentElement
    )
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    (focus ?? row).scrollIntoView({ block: "nearest" });
    focus?.focus();
  });
  return true;
}
