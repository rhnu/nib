import { createStore } from "zustand/vanilla";
import type { LexiconKind, LexiconTerm } from "@/bindings/lexicon";
import type { PromptSyntaxProfile } from "@/bindings/prompt";
import { moveItem } from "@/features/prompt/model";

export type SelectedTerm = { term: LexiconTerm; weight: string; emphasis: string };
export type LexiconSession = {
  text: string;
  kind: LexiconKind | "";
  mode: "lexical" | "semantic";
  target: "positive" | "negative";
  generation: string | null;
  selected: SelectedTerm[];
  related: LexiconTerm | null;
  invalidated: boolean;
};

/** A workbench owns the full-page session; a quick picker owns its own short-lived session. */
export function createLexiconSessionStore() {
  return createStore<LexiconSession>(() => ({
    text: "",
    kind: "",
    mode: "lexical",
    target: "positive",
    generation: null,
    selected: [],
    related: null,
    invalidated: false,
  }));
}

export type LexiconSessionStore = ReturnType<typeof createLexiconSessionStore>;

/** Resource replacements invalidate term snapshots, while keeping the browsing context. */
export function synchronizeLexiconGeneration(
  store: LexiconSessionStore,
  generation: string | null,
) {
  const state = store.getState();
  if (state.generation === generation) return;
  store.setState({
    generation,
    selected: [],
    related: null,
    invalidated: state.invalidated || state.selected.length > 0,
  });
}

export function toggleLexiconTerm(store: LexiconSessionStore, term: LexiconTerm) {
  const { selected } = store.getState();
  store.setState({
    invalidated: false,
    selected: selected.some((item) => item.term.key === term.key)
      ? selected.filter((item) => item.term.key !== term.key)
      : [...selected, { term, weight: "1", emphasis: "0" }],
  });
}

export function moveLexiconTerm(store: LexiconSessionStore, index: number, offset: number) {
  store.setState(({ selected }) => ({ selected: moveItem(selected, index, offset) }));
}

/** Keep numeric weights and bracket counts independent when switching model syntax. */
export function lexiconFormatTerms(selected: SelectedTerm[], profile: PromptSyntaxProfile) {
  return selected.map(({ term, weight, emphasis }) => ({
    name: term.promptText,
    weight: profile.numericWeights ? Number(weight) : profile.bracketWeights ? Number(emphasis) : 0,
  }));
}

export function validLexiconSelection(selected: SelectedTerm[], profile?: PromptSyntaxProfile) {
  if (!profile || selected.length === 0) return false;
  return selected.every(({ weight, emphasis }) => {
    if (!profile.numericWeights && !profile.bracketWeights) return true;
    const input = profile.numericWeights ? weight : emphasis;
    const value = Number(input);
    return (
      input.trim() !== "" &&
      Number.isFinite(value) &&
      (profile.numericWeights
        ? profile.negativeWeights || value >= 0
        : Number.isInteger(value) && Math.abs(value) <= 30)
    );
  });
}
