import type { LexiconKind, LexiconSearchResult, LexiconStatus } from "@/bindings/lexicon";
import { invokeHost } from "@/shared/host/invoke";
import { queryClient } from "@/shared/query/client";
import { matchesLexiconStatus, sameLexiconState } from "./lexicon-state";

export const lexiconStatusKey = ["lexicon-status"] as const;
export const semanticSearchKey = ["lexicon-semantic-search"] as const;
let revision = 0;

/** Resource or semantic policy changes invalidate pending lookups and editor insertions. */
export function lexiconRevision() {
  return revision;
}

export const lexiconApi = {
  async status() {
    const result = await invokeHost<LexiconStatus>("get_lexicon_status");
    const previous = queryClient.getQueryData<LexiconStatus>(lexiconStatusKey);
    if (!sameLexiconState(previous, result)) revision++;
    return result;
  },
  search: (text: string, kinds: LexiconKind[], semantic: boolean, limit = 30, relatedTo?: string) =>
    invokeHost<LexiconSearchResult>("search_lexicon", {
      query: { text, kinds, semantic, limit, relatedTo },
    }),
};

/** Saved preferences take effect before another status poll can publish obsolete semantics. */
export function savedSemanticSearchChanged(enabled: boolean) {
  revision++;
  void queryClient.cancelQueries({ queryKey: lexiconStatusKey });
  queryClient.setQueryData<LexiconStatus>(lexiconStatusKey, (status) =>
    status ? { ...status, semanticEnabled: enabled, semanticAvailable: false } : status,
  );
  void queryClient.cancelQueries({ queryKey: semanticSearchKey });
  queryClient.removeQueries({ queryKey: semanticSearchKey });
  void queryClient.invalidateQueries({ queryKey: lexiconStatusKey });
}

export function isCurrentLexicon(
  generation: string | null,
  startedRevision: number,
  resultRevision?: number,
) {
  const status = queryClient.getQueryData<LexiconStatus>(lexiconStatusKey);
  return revision === startedRevision && matchesLexiconStatus(status, generation, resultRevision);
}
