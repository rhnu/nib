import type {
  CreationOperation,
  DirectorToolKind,
  DirectorToolState,
  DirectorWorkspace,
  Draft,
} from "../../bindings/workbench";
import { emptyComposition, emptyReferences, emptySettings } from "../prompt/model";
import type { GenerationResult } from "../../bindings/generation";

type DirectorOperation = Extract<CreationOperation, { kind: "director" }>;

export const directorToolLabels: Record<DirectorToolKind, string> = {
  lineart: "描线",
  sketch: "草图",
  bgRemoval: "去背景",
  emotion: "情绪",
  declutter: "清理",
  declutterKeepBubbles: "保留对白清理",
  colorize: "着色",
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
      operation: { kind: "director", assetId, command },
      policy,
      stream: null,
      references: emptyReferences(),
    },
    maskEditor: { activeSourceId: null, sessions: [] },
    vibeEncoder: null,
    director: { selectedTool: "lineart", tools: [] },
    pngTextEditor: { sessions: [] },
    activePage: "director",
  };
}

export function directorOutputLabel(
  result: Pick<GenerationResult, "sampleIndex" | "imageSource">,
): string {
  const source = result.imageSource;
  return source?.kind === "archive" ? source.name : `输出 ${result.sampleIndex + 1}`;
}
