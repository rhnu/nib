import { describe, expect, it } from "vitest";
import type { LexiconTerm } from "@/bindings/lexicon";
import type { PromptSyntaxProfile } from "@/bindings/prompt";
import {
  createLexiconSessionStore,
  lexiconFormatTerms,
  moveLexiconTerm,
  synchronizeLexiconGeneration,
  toggleLexiconTerm,
  validLexiconSelection,
} from "./lexicon-session";

const term = (key: string, promptText = key): LexiconTerm => ({
  key,
  name: key,
  promptText,
  kind: "general",
  translation: null,
  description: null,
  postCount: 0,
  aliases: [],
  groups: [],
  source: "test",
});

const profile = (options: Partial<PromptSyntaxProfile> = {}): PromptSyntaxProfile => ({
  bracketWeights: false,
  numericWeights: false,
  negativeWeights: false,
  legacyMixing: false,
  characterSeparators: false,
  randomizer: false,
  textRendering: false,
  interactionTags: false,
  ...options,
});

describe("lexicon combination session", () => {
  it("keeps selected terms across searches and filters, without duplicates", () => {
    const store = createLexiconSessionStore();
    toggleLexiconTerm(store, term("a"));
    store.setState({ text: "another search", kind: "artist", mode: "semantic" });
    toggleLexiconTerm(store, term("b"));
    expect(store.getState().selected.map(({ term }) => term.key)).toEqual(["a", "b"]);
    toggleLexiconTerm(store, term("a"));
    expect(store.getState().selected.map(({ term }) => term.key)).toEqual(["b"]);
  });
  it("reorders the output and ignores moves beyond either end", () => {
    const store = createLexiconSessionStore();
    toggleLexiconTerm(store, term("a", "first prompt"));
    toggleLexiconTerm(store, term("b", "second prompt"));
    moveLexiconTerm(store, 1, -1);
    moveLexiconTerm(store, 0, -1);
    moveLexiconTerm(store, 1, 1);
    expect(
      lexiconFormatTerms(store.getState().selected, profile()).map(({ name }) => name),
    ).toEqual(["second prompt", "first prompt"]);
  });
  it("keeps the current generation but rejects old selections after resource replacement", () => {
    const store = createLexiconSessionStore();
    synchronizeLexiconGeneration(store, "old");
    toggleLexiconTerm(store, term("a"));
    store.setState({
      text: "light",
      kind: "general",
      mode: "semantic",
      target: "negative",
      related: term("a"),
    });
    synchronizeLexiconGeneration(store, "old");
    expect(store.getState().selected).toHaveLength(1);
    synchronizeLexiconGeneration(store, "new");
    expect(store.getState()).toMatchObject({
      text: "light",
      kind: "general",
      mode: "semantic",
      target: "negative",
      selected: [],
      related: null,
      invalidated: true,
    });
    toggleLexiconTerm(store, term("b"));
    expect(store.getState().invalidated).toBe(false);
  });
  it("keeps numeric weights and bracket emphasis independent across models", () => {
    const selection = [
      { term: term("display name", "resource prompt text"), weight: "1.5", emphasis: "-2" },
    ];
    expect(lexiconFormatTerms(selection, profile({ numericWeights: true }))).toEqual([
      { name: "resource prompt text", weight: 1.5 },
    ]);
    expect(lexiconFormatTerms(selection, profile({ bracketWeights: true }))).toEqual([
      { name: "resource prompt text", weight: -2 },
    ]);
    expect(lexiconFormatTerms(selection, profile())).toEqual([
      { name: "resource prompt text", weight: 0 },
    ]);
  });
  it("rejects incomplete, non-finite and unsupported weights", () => {
    const numeric = profile({ numericWeights: true });
    const brackets = profile({ bracketWeights: true });
    const item = { term: term("a"), weight: "1", emphasis: "0" };
    expect(validLexiconSelection([], numeric)).toBe(false);
    expect(validLexiconSelection([item])).toBe(false);
    for (const weight of ["", " ", "NaN", "Infinity", "-0.5"])
      expect(validLexiconSelection([{ ...item, weight }], numeric)).toBe(false);
    expect(
      validLexiconSelection(
        [{ ...item, weight: "-0.5" }],
        profile({ numericWeights: true, negativeWeights: true }),
      ),
    ).toBe(true);
    for (const emphasis of ["", "0.5", "31", "-31"])
      expect(validLexiconSelection([{ ...item, emphasis }], brackets)).toBe(false);
    expect(validLexiconSelection([{ ...item, emphasis: "-2" }], brackets)).toBe(true);
  });
});
