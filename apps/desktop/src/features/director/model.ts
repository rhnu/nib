import { t } from "@/shared/i18n";
import type {
  CreationOperation,
  DirectorToolKind,
  DirectorToolState,
  DirectorWorkspace,
  Draft,
} from "@/bindings/workbench";
import { emptyComposition, emptyReferences, emptySettings } from "@/features/prompt/model";
import type { GenerationResult } from "@/bindings/generation";

type DirectorOperation = Extract<CreationOperation, { kind: "director" }>;

export const directorToolLabels: Record<DirectorToolKind, string> = {
  get lineart() {
    return t("director.lineArt");
  },
  get sketch() {
    return t("director.sketch");
  },
  get bgRemoval() {
    return t("director.removeBackground");
  },
  get emotion() {
    return t("director.emotion");
  },
  get declutter() {
    return t("director.declutter");
  },
  get declutterKeepBubbles() {
    return t("director.declutterKeepText");
  },
  get colorize() {
    return t("director.colorize");
  },
};

export function commandTool(command: DirectorOperation["command"]): DirectorToolKind {
  if (typeof command !== "string") return "emotion" in command ? "emotion" : "colorize";
  if (command === "bg_removal") return "bgRemoval";
  if (command === "declutter_keep_bubbles") return "declutterKeepBubbles";
  return command;
}

export function selectedDirectorTool(workspace: DirectorWorkspace): DirectorToolState | undefined {
  return workspace.tools.find((tool) => tool.tool === workspace.selectedTool);
}

export function updateDirectorTool(
  workspace: DirectorWorkspace,
  tool: DirectorToolKind,
  patch: Partial<Omit<DirectorToolState, "tool">>,
): DirectorWorkspace {
  return {
    ...workspace,
    tools: workspace.tools.map((state) => (state.tool === tool ? { ...state, ...patch } : state)),
  };
}

/** Restoring a tool submission keeps the main creation and every other tool's edits intact. */
export function restoreDirectorWorkspace(
  workspace: DirectorWorkspace,
  operation: DirectorOperation,
): DirectorWorkspace {
  const tool = commandTool(operation.command);
  return {
    ...updateDirectorTool(workspace, tool, {
      assetId: operation.assetId,
      command: operation.command,
    }),
    selectedTool: tool,
  };
}

/** Only the temporary quote/submission receives Director inputs. */
export function directorSubmission(draft: Draft): Draft | null {
  const state = selectedDirectorTool(draft.director);
  return directorToolSubmission(state?.assetId ?? null, state?.command, state?.policy);
}

export function directorToolSubmission(
  assetId: string | null,
  command: DirectorToolState["command"] | undefined,
  policy: DirectorToolState["policy"] | undefined,
): Draft | null {
  if (!assetId || command === undefined || policy === undefined) return null;
  return {
    revision: 0,
    composition: emptyComposition(),
    presets: [],
    characters: [],
    settings: emptySettings(),
    inputs: {
      requestCount: 1,
      operation: { kind: "director", assetId, command },
      policy,
      stream: null,
      references: emptyReferences(),
    },
    maskEditor: { activeSourceId: null, sessions: [] },
    vibeEncoder: null,
    director: { selectedTool: "lineart", tools: [] },
    pngTextEditor: { sessions: [] },
    promptEditor: { collapsedBlocks: {} },
    activePage: "director",
  };
}

export function directorOutputLabel(
  result: Pick<GenerationResult, "sampleIndex" | "imageSource">,
): string {
  const source = result.imageSource;
  return source?.kind === "archive"
    ? source.name
    : t("director.outputNumber", { value0: result.sampleIndex + 1 });
}
