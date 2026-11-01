import { describe, expect, it } from "vitest";
import type {
  InstanceOverride,
  PromptNode,
  ResolvedDraft,
  ResolutionIssue,
} from "@/bindings/workbench";
import { precedingPresetSources, precedingPromptSources } from "./format-context";

describe("formatting source context", () => {
  it("uses earlier presets in the same scope and ignores unrelated resolution failures", () => {
    const fragment = (presetInstanceId: string, scope: "positive" | "negative", text: string) => ({
      text,
      scope,
      nodeId: "node",
      presetInstanceId,
      resourceId: null,
      resourceName: null,
      overridden: false,
      expanded: false,
    });

    const issue: ResolutionIssue = {
      kind: "missingResource",
      scope: "negative",
      presetInstanceId: "before",
      characterId: null,
      nodeId: "missing",
      resourceId: "missing",
      message: { kind: "external", detail: "missing" },
    };
    const resolved: Pick<ResolvedDraft, "fragments" | "issues"> = {
      fragments: [
        fragment("before", "positive", "Text:"),
        fragment("before", "negative", "other"),
        fragment("after", "positive", "later"),
      ],
      issues: [issue],
    };
    expect(precedingPresetSources(resolved, new Set(["before"]), "positive")).toEqual(["Text:"]);
    expect(() =>
      precedingPresetSources(
        { ...resolved, issues: [{ ...issue, scope: "positive" }] },
        new Set(["before"]),
        "positive",
      ),
    ).toThrow();
  });

  it("keeps effective enabled source order and per-fragment comment boundaries", () => {
    const nodes: PromptNode[] = [
      { kind: "text", id: "a", enabled: true, text: "// Text:" },
      { kind: "text", id: "b", enabled: false, text: "disabled" },
      { kind: "chunk", id: "c", enabled: true, resourceId: "missing", overrideText: null },
      { kind: "text", id: "d", enabled: true, text: "target" },
    ];
    const overrides: InstanceOverride[] = [{ nodeId: "c", enabled: null, text: "Text:" }];
    expect(precedingPromptSources(nodes, 3, new Map(), overrides)).toEqual(["// Text:", "Text:"]);
    expect(precedingPromptSources(nodes, 3, new Map())).toBeNull();
  });
});
