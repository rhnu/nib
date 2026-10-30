import type { LexiconKind, LexiconSearchResult, LexiconStatus } from "@/bindings/lexicon";
import { invokeHost } from "@/shared/host/invoke";
import { queryClient } from "@/shared/query/client";

export const lexiconStatusKey = ["lexicon-status"] as const;
let revision = 0;

/** Installation invalidates pending lookups before a replacement generation becomes visible. */
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
  async install(manifestUrl: string, semantic: boolean) {
    revision++;
    await invokeHost("install_lexicon", { manifestUrl, semantic });
    await queryClient.invalidateQueries({ queryKey: lexiconStatusKey });
  },
  async cancel() {
    await invokeHost("cancel_lexicon_install");
    await queryClient.invalidateQueries({ queryKey: lexiconStatusKey });
  },
};

export function isCurrentLexicon(generation: string | null, startedRevision: number) {
  const status = queryClient.getQueryData<LexiconStatus>(lexiconStatusKey);
  return revision === startedRevision && (!status || status.generation === generation);
}
