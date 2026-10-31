import type { LexiconKind, LexiconSearchResult, LexiconStatus } from "@/bindings/lexicon";
import { invokeHost } from "@/shared/host/invoke";
import { queryClient } from "@/shared/query/client";

export const lexiconStatusKey = ["lexicon-status"] as const;
let revision = 0;

/** A changed resource generation invalidates pending lookups and editor insertions. */
export function lexiconRevision() {
  return revision;
}

export const lexiconApi = {
  async status() {
    const result = await invokeHost<LexiconStatus>("get_lexicon_status");
    const previous = queryClient.getQueryData<LexiconStatus>(lexiconStatusKey);
    if (previous?.generation !== result.generation) revision++;
    return result;
  },
  search: (text: string, kinds: LexiconKind[], semantic: boolean, limit = 30, relatedTo?: string) =>
    invokeHost<LexiconSearchResult>("search_lexicon", {
      query: { text, kinds, semantic, limit, relatedTo },
    }),
};

export function isCurrentLexicon(generation: string | null, startedRevision: number) {
  const status = queryClient.getQueryData<LexiconStatus>(lexiconStatusKey);
  return revision === startedRevision && generation !== null && status?.generation === generation;
}
