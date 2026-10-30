import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "zustand";
import { isCurrentLexicon, lexiconApi, lexiconRevision } from "./api";
import { synchronizeLexiconGeneration, type LexiconSessionStore } from "./lexicon-session";
import { useLexiconStatus } from "./use-lexicon-status";

/** Both browsing surfaces share lexical-first retrieval and optional delayed semantic results. */
export function useLexiconSearch(store: LexiconSessionStore) {
  const state = useStore(store);
  const status = useLexiconStatus();
  const generation = status.data?.generation ?? null;
  const [pausedText, setPausedText] = useState(state.text);
  useEffect(() => {
    const timer = setTimeout(() => setPausedText(state.text), 350);
    return () => clearTimeout(timer);
  }, [state.text]);
  useEffect(() => {
    if (status.isSuccess) synchronizeLexiconGeneration(store, generation);
  }, [store, status.isSuccess, generation]);
  const kinds = state.kind ? [state.kind] : [];
  const semantic = state.mode === "semantic" && Boolean(status.data?.semanticAvailable);
  const lexical = useQuery({
    queryKey: ["lexicon-search", generation, state.text, state.kind, false],
    queryFn: () => lexiconApi.search(state.text, kinds, false, 60),
    enabled: Boolean(generation),
    staleTime: 30_000,
    retry: false,
  });
  const meaning = useQuery({
    queryKey: ["lexicon-search", generation, pausedText, state.kind, true],
    queryFn: () => lexiconApi.search(pausedText, kinds, true, 30),
    enabled:
      Boolean(generation) && semantic && Boolean(pausedText.trim()) && state.text === pausedText,
    staleTime: 30_000,
    retry: false,
  });
  const relatedTerm = state.generation === generation ? state.related : null;
  const related = useQuery({
    queryKey: ["lexicon-related", generation, relatedTerm?.key, state.kind],
    queryFn: () => lexiconApi.search("", kinds, false, 20, relatedTerm!.key),
    enabled: Boolean(generation) && Boolean(relatedTerm),
    staleTime: 30_000,
    retry: false,
  });
  const revision = lexiconRevision();
  const lexicalMatches =
    lexical.data && isCurrentLexicon(lexical.data.generation, revision) ? lexical.data.matches : [];
  const meaningCurrent = semantic && state.text === pausedText && Boolean(state.text.trim());
  const semanticMatches =
    meaningCurrent && meaning.data && isCurrentLexicon(meaning.data.generation, revision)
      ? meaning.data.matches
      : [];
  const matches = [
    ...lexicalMatches,
    ...semanticMatches.filter(
      (match) => !lexicalMatches.some((other) => other.term.key === match.term.key),
    ),
  ];
  const relatedMatches =
    related.data && isCurrentLexicon(related.data.generation, revision) ? related.data.matches : [];
  const waiting = semantic && Boolean(state.text.trim()) && state.text !== pausedText;
  return {
    state,
    status,
    generation,
    lexical,
    meaning,
    meaningCurrent,
    related,
    relatedTerm,
    matches,
    relatedMatches,
    loading: lexical.isFetching || (meaningCurrent && meaning.isFetching) || waiting,
  };
}
