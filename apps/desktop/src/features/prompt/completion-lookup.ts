import type { LexiconMatch, LexiconSearchResult } from "@/bindings/lexicon";

/** Debounce both lookups and publish lexical results before optional semantic additions. */
export function lookupCompletions(
  input: { text: string; semantic: boolean; elapsed: number },
  search: (text: string, semantic: boolean) => Promise<LexiconSearchResult>,
  current: (result?: LexiconSearchResult) => boolean,
  publish: (matches: LexiconMatch[]) => void,
) {
  let cancelled = false;
  let lexicalDone = false;
  let semanticDone = !input.semantic;
  let lexical: LexiconMatch[] = [];
  let semantic: LexiconMatch[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];

  const run = (isSemantic: boolean, delay: number) => {
    timers.push(
      setTimeout(
        async () => {
          if (cancelled || !current()) return;
          let matches: LexiconMatch[] = [];
          try {
            const result = await search(input.text, isSemantic);
            if (cancelled || !current(result)) return;
            matches = result.matches.filter(
              (match) => isSemantic === (match.reason === "semantic" || match.reason === "related"),
            );
          } catch {
            // Optional lookup failures must not interrupt editing; the lexicon browser offers retry.
            if (cancelled || !current()) return;
          }
          if (isSemantic) {
            semantic = matches;
            semanticDone = true;
          } else {
            lexical = matches;
            lexicalDone = true;
          }
          // An empty lexical response must not hide the previous list while semantics is pending.
          if (lexicalDone && (lexical.length || semantic.length || semanticDone))
            publish([...lexical, ...semantic]);
        },
        Math.max(0, delay - input.elapsed),
      ),
    );
  };

  run(false, 200);
  if (input.semantic) run(true, 350);
  return () => {
    cancelled = true;
    for (const timer of timers) clearTimeout(timer);
  };
}
