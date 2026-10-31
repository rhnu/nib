import { useLayoutEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "zustand";
import { LexiconWorkspace, type LexiconInsert } from "@/features/lexicon/lexicon-workspace";
import { isCurrentLexicon, lexiconRevision } from "@/features/lexicon/api";
import { useWorkbenchContext } from "@/features/workbench/workbench-context";
import { promptApi } from "@/features/prompt/api";
import { formatLexiconTerms } from "@/features/prompt/format-runtime";
import { textNode } from "@/features/prompt/model";
import { trackPendingWork } from "@/shared/host/pending-work";
import { errorMessage } from "@/shared/host/error";
import { Button, Notice } from "@/shared/ui";
import { t, useTranslation, MessageError, deferMessage } from "@/shared/i18n";

/** Full-page combinations append a new text fragment, leaving existing prompt content intact. */
export function LexiconPage() {
  useTranslation();
  const { state, workspace, options, openDownloads } = useWorkbenchContext();
  const { lexiconSession: store } = state;
  const target = useStore(store, (value) => value.target);
  const model =
    state.draft.settings.model ?? state.resolved?.settings.model ?? workspace.info.defaultModelId;
  const syntax = useQuery({
    queryKey: ["prompt-syntax", model],
    queryFn: () => promptApi.syntax(model),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const current = useRef({ model, profile: syntax.data });
  useLayoutEffect(() => {
    current.current = { model, profile: syntax.data };
  }, [model, syntax.data]);

  const insert: LexiconInsert = async (terms, generation) => {
    const profile = syntax.data;
    if (!profile) return false;
    const revision = lexiconRevision();
    await trackPendingWork(
      (async () => {
        const text = await formatLexiconTerms(terms, profile);
        // Formatting is asynchronous; restoring a model or updating resources invalidates its input.
        if (
          current.current.model !== model ||
          current.current.profile !== profile ||
          !isCurrentLexicon(generation, revision)
        )
          throw new MessageError(deferMessage(() => t("lexicon.staleCombination")));
        state.writer.update((draft) => {
          draft.composition[target].push(textNode(text));
        });
      })(),
    );
    // Navigation must follow the tracked commit so its guard does not wait on itself.
    await options.navigate("create");
    return true;
  };

  return (
    <section className="lexicon-page" aria-label={t("lexicon.title")}>
      {syntax.error && (
        <Notice
          actions={<Button onClick={() => void syntax.refetch()}>{t("lexicon.retry")}</Button>}
        >
          {errorMessage(syntax.error)}
        </Notice>
      )}
      <LexiconWorkspace
        store={store}
        profile={syntax.data}
        onInsert={insert}
        onOpenDownloads={() => void openDownloads()}
        targetSelector={
          <label className="lexicon-target">
            {t("lexicon.target")}
            <select
              value={target}
              onChange={(event) =>
                store.setState({ target: event.target.value as "positive" | "negative" })
              }
            >
              <option value="positive">{t("prompt.positivePrompt")}</option>
              <option value="negative">{t("prompt.negativePrompt")}</option>
            </select>
          </label>
        }
      />
    </section>
  );
}
