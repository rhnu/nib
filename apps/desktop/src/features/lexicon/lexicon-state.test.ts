import { describe, expect, it } from "vitest";
import type { LexiconStatus } from "@/bindings/lexicon";
import { matchesLexiconStatus, sameLexiconState } from "./lexicon-state";

function status(revision: number, semanticEnabled = true): LexiconStatus {
  return {
    generation: "installed",
    revision,
    semanticEnabled,
    semanticAvailable: semanticEnabled,
    loading: false,
    error: null,
    termCount: 1,
  };
}

describe("lexicon resource and semantic identity", () => {
  it("keeps lexical results when only semantic search is switched off", () => {
    const disabled = status(2, false);
    expect(matchesLexiconStatus(disabled, "installed")).toBe(true);
    expect(sameLexiconState(status(1), disabled)).toBe(false);
  });

  it("rejects semantic results from before a rapid off and on cycle", () => {
    const initial = status(1);
    const reopened = status(3);
    expect(matchesLexiconStatus(initial, "installed", 1)).toBe(true);
    expect(matchesLexiconStatus(status(2, false), "installed", 1)).toBe(false);
    expect(matchesLexiconStatus(reopened, "installed", 1)).toBe(false);
    expect(matchesLexiconStatus(reopened, "installed", 3)).toBe(true);
    expect(sameLexiconState(initial, reopened)).toBe(false);
  });

  it("retires pending work as soon as saved availability changes", () => {
    const previous = status(1);
    const saved = { ...previous, semanticEnabled: false, semanticAvailable: false };
    expect(sameLexiconState(previous, saved)).toBe(false);
    expect(sameLexiconState(saved, { ...saved, loading: true })).toBe(true);
  });

  it("rejects missing status and replaced resources", () => {
    expect(matchesLexiconStatus(undefined, "installed", 1)).toBe(false);
    expect(matchesLexiconStatus(status(1), null)).toBe(false);
    expect(matchesLexiconStatus(status(1), "replaced", 1)).toBe(false);
  });
});
