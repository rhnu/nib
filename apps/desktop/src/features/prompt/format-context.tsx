import { createContext, useContext, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import type {
  Draft,
  InstanceOverride,
  PromptNode,
  Resource,
  ResolvedDraft,
} from "@/bindings/workbench";
import { t, deferMessage, MessageError } from "@/shared/i18n";
import { promptApi } from "./api";
import { usePromptEditorPath } from "./prompt-editor-state";

export type FormattingContext = { precedingSources: string[]; current: () => boolean };
type ContextRequest = { path: readonly string[]; precedingSources: string[] };
type ContextResolver = (request: ContextRequest) => Promise<FormattingContext>;
const FormattingContext = createContext<ContextResolver | null>(null);

/** Only failures in earlier contributions to this scope prevent reconstructing its prefix. */
export function precedingPresetSources(
  resolved: Pick<ResolvedDraft, "fragments" | "issues">,
  earlier: ReadonlySet<string>,
  scope: string | undefined,
) {
  if (
    resolved.issues.some(
      (issue) =>
        issue.presetInstanceId !== null &&
        earlier.has(issue.presetInstanceId) &&
        issue.characterId === null &&
        (issue.scope === null || issue.scope === scope) &&
        issue.kind !== "modelMismatch",
    )
  )
    throw new MessageError(deferMessage(() => t("prompt.formatContextUnavailable")));
  return resolved.fragments
    .filter(
      (fragment) =>
        fragment.scope === scope &&
        fragment.presetInstanceId !== null &&
        earlier.has(fragment.presetInstanceId),
    )
    .map((fragment) => fragment.text);
}

/** Resource compositions supply the effective enabled siblings before this editor. */
export function precedingPromptSources(
  nodes: PromptNode[],
  index: number,
  resources: Map<string, Resource>,
  overrides: InstanceOverride[] = [],
) {
  const sources: string[] = [];
  for (const node of nodes.slice(0, index)) {
    const override = overrides.find((item) => item.nodeId === node.id);
    if (!(override?.enabled ?? node.enabled)) continue;
    const resource = node.kind === "chunk" ? resources.get(node.resourceId) : undefined;
    const text =
      override?.text ??
      (node.kind === "text"
        ? node.text
        : (node.overrideText ??
          (resource?.content.kind === "chunk" ? resource.content.text : undefined)));
    if (text === undefined) return null;
    if (text.trim()) sources.push(text);
  }
  return sources;
}

/** Main scopes inherit earlier presets; their order and content come from fresh Rust resolution. */
export function PromptFormattingProvider({
  readDraft,
  resources,
  children,
}: {
  readDraft: () => Draft;
  resources: Map<string, Resource>;
  children: ReactNode;
}) {
  const latest = useRef({ readDraft, resources });
  useLayoutEffect(() => {
    latest.current = { readDraft, resources };
  }, [readDraft, resources]);
  const resolve = useMemo<ContextResolver>(
    () =>
      async ({ path, precedingSources }) => {
        const snapshot = latest.current.readDraft();
        const resourceSnapshot = latest.current.resources;

        const current = () =>
          latest.current.readDraft() === snapshot && latest.current.resources === resourceSnapshot;

        if (path.includes("character")) return { precedingSources, current };
        const instanceId = path[0] === "preset" ? path[1] : null;
        const limit = instanceId
          ? snapshot.presets.findIndex((preset) => preset.id === instanceId)
          : snapshot.presets.length;
        const earlier = new Set(
          snapshot.presets
            .slice(0, Math.max(0, limit))
            .filter((preset) => preset.enabled)
            .map((preset) => preset.id),
        );
        if (!earlier.size) return { precedingSources, current };
        const { resolved } = await promptApi.resolve(snapshot);
        return {
          precedingSources: [
            ...precedingPresetSources(resolved, earlier, path.at(-1)),
            ...precedingSources,
          ],
          current,
        };
      },
    [],
  );
  return <FormattingContext.Provider value={resolve}>{children}</FormattingContext.Provider>;
}

/** Standalone fields and resource originals have no creation-level preset prefix. */
export function useFormattingContext(precedingSources: string[] | null) {
  const resolve = useContext(FormattingContext);
  const path = usePromptEditorPath();
  const key = JSON.stringify([path, precedingSources]);
  return useMemo(
    () => async (): Promise<FormattingContext> => {
      const [currentPath, sources] = JSON.parse(key) as [string[], string[] | null];
      if (sources === null)
        throw new MessageError(deferMessage(() => t("prompt.formatContextUnavailable")));
      return resolve
        ? resolve({ path: currentPath, precedingSources: sources })
        : { precedingSources: sources, current: () => true };
    },
    [key, resolve],
  );
}
