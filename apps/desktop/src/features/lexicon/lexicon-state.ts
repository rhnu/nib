import type { LexiconStatus } from "@/bindings/lexicon";

/** Availability changes also retire pending work when installed resources keep their generation. */
export function sameLexiconState(
  left: LexiconStatus | undefined,
  right: LexiconStatus | undefined,
) {
  return (
    left?.generation === right?.generation &&
    left?.revision === right?.revision &&
    left?.semanticEnabled === right?.semanticEnabled &&
    left?.semanticAvailable === right?.semanticAvailable
  );
}

/** Lexical results follow resources; semantic results must also match the current policy revision. */
export function matchesLexiconStatus(
  status: LexiconStatus | undefined,
  generation: string | null,
  semanticRevision?: number,
) {
  return (
    generation !== null &&
    status?.generation === generation &&
    (semanticRevision === undefined || status.revision === semanticRevision)
  );
}
