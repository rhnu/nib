import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LexiconFormatTerm, PromptSyntaxProfile } from "@/bindings/prompt";
import { BookOpen, Search, X } from "lucide-react";
import { Button, HelpMarker, IconButton, Notice } from "@/shared/ui";
import { t, useTranslation } from "@/shared/i18n";
import { errorMessage } from "@/shared/host/error";
import { kindLabel, lexiconKinds } from "./labels";
import { toggleLexiconTerm, type LexiconSessionStore } from "./lexicon-session";
import { LexiconTermRow } from "./lexicon-term-row";
import { LexiconComposer } from "./lexicon-composer";
import { useLexiconSearch } from "./use-lexicon-search";
import "./styles.css";

export type LexiconInsert = (
  terms: LexiconFormatTerm[],
  generation: string | null,
) => Promise<boolean>;

/** A single browsing and composition surface serves the route and quick insertion dialog. */
export function LexiconWorkspace({
  store,
  profile,
  readOnly = false,
  onInsert,
  onInserted,
  onBusy,
  targetSelector,
  onOpenDownloads,
}: {
  store: LexiconSessionStore;
  profile?: PromptSyntaxProfile;
  readOnly?: boolean;
  onInsert?: LexiconInsert;
  onInserted?: () => void;
  onBusy?: (busy: boolean) => void;
  targetSelector?: ReactNode;
  onOpenDownloads: () => void;
}) {
  useTranslation();
  const search = useLexiconSearch(store);
  const {
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
    loading,
  } = search;
  const [busy, setBusy] = useState(false);
  const restoring = status.isPending || Boolean(status.data?.loading);
  const resourceError = status.data?.error;
  const semanticHint =
    status.data?.semanticEnabled === false
      ? t("lexicon.semanticDisabled")
      : t("lexicon.semanticUnavailable");
  const notInstalled = status.isSuccess && !restoring && !resourceError && !generation;
  const selected = state.generation === generation ? state.selected : [];
  const relatedRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    relatedRef.current?.scrollIntoView({ block: "nearest" });
  }, [relatedTerm?.key]);

  const renderTerms = (items: typeof matches) =>
    items.map((match) => (
      <LexiconTermRow
        key={match.term.key}
        match={match}
        selected={selected.some((item) => item.term.key === match.term.key)}
        onSelect={(term) => toggleLexiconTerm(store, term)}
        onRelated={(term) => store.setState({ related: term })}
      />
    ));

  return (
    <fieldset className="lexicon-workspace" disabled={busy} aria-label={t("lexicon.title")}>
      <div className="lexicon-toolbar">
        <div className="lexicon-search-field">
          <Search size={15} aria-hidden />
          <input
            aria-label={t("lexicon.search")}
            placeholder={t("lexicon.search")}
            value={state.text}
            onChange={(event) => store.setState({ text: event.target.value })}
            spellCheck={false}
          />
        </div>
        <fieldset className="lexicon-modes" aria-label={t("lexicon.searchMode")}>
          <Button
            aria-pressed={state.mode === "lexical"}
            onClick={() => store.setState({ mode: "lexical" })}
          >
            {t("lexicon.lexical")}
          </Button>
          <Button
            aria-pressed={state.mode === "semantic"}
            disabled={!status.data?.semanticAvailable}
            title={!status.data?.semanticAvailable ? semanticHint : undefined}
            onClick={() => store.setState({ mode: "semantic" })}
          >
            {t("lexicon.semantic")}
          </Button>
        </fieldset>
        {generation && !status.data?.semanticAvailable && (
          <HelpMarker label={t("lexicon.semantic")}>{semanticHint}</HelpMarker>
        )}
      </div>
      {notInstalled ? (
        <section className="lexicon-empty" aria-label={t("lexicon.results")}>
          <BookOpen size={32} aria-hidden />
          <h2>{t("lexicon.notInstalled")}</h2>
          <Button className="primary" onClick={onOpenDownloads}>
            {t("lexicon.openDownloads")}
          </Button>
        </section>
      ) : (
        <div className="lexicon-body">
          <section className="lexicon-browse" aria-label={t("lexicon.results")}>
            <fieldset className="lexicon-kinds" aria-label={t("lexicon.all")}>
              <Button aria-pressed={state.kind === ""} onClick={() => store.setState({ kind: "" })}>
                {t("lexicon.all")}
              </Button>
              {lexiconKinds.map((kind) => (
                <Button
                  key={kind}
                  aria-pressed={state.kind === kind}
                  onClick={() => store.setState({ kind })}
                >
                  {kindLabel(kind)}
                </Button>
              ))}
            </fieldset>
            <div className="lexicon-browse-scroll">
              {restoring && !generation ? (
                <output>{t("lexicon.restoring")}</output>
              ) : status.error ? (
                <Notice
                  actions={
                    <Button onClick={() => void status.refetch()}>{t("lexicon.retry")}</Button>
                  }
                >
                  {errorMessage(status.error)}
                </Notice>
              ) : (
                <>
                  {resourceError && (
                    <Notice
                      actions={
                        <Button onClick={onOpenDownloads}>{t("lexicon.openDownloads")}</Button>
                      }
                    >
                      {resourceError}
                    </Notice>
                  )}
                  {restoring && <output>{t("lexicon.restoring")}</output>}
                  {lexical.error && (
                    <Notice
                      actions={
                        <Button onClick={() => void lexical.refetch()}>{t("lexicon.retry")}</Button>
                      }
                    >
                      {errorMessage(lexical.error)}
                    </Notice>
                  )}
                  {meaningCurrent && meaning.error && (
                    <Notice
                      actions={
                        <div className="ui-actions">
                          <Button onClick={() => void meaning.refetch()}>
                            {t("lexicon.retry")}
                          </Button>
                          <Button onClick={onOpenDownloads}>{t("lexicon.openDownloads")}</Button>
                        </div>
                      }
                    >
                      {errorMessage(meaning.error)}
                    </Notice>
                  )}
                  {loading && <output>{t("lexicon.loading")}</output>}
                  {!lexical.isPending &&
                    !resourceError &&
                    !loading &&
                    matches.length === 0 &&
                    !lexical.error &&
                    !(meaningCurrent && meaning.error) && (
                      <p className="empty-note">{t("lexicon.noMatches")}</p>
                    )}
                  <ul
                    className="lexicon-results"
                    aria-label={t("lexicon.results")}
                    aria-busy={loading}
                  >
                    {renderTerms(matches)}
                  </ul>
                  {relatedTerm && (
                    <section
                      ref={relatedRef}
                      className="lexicon-related"
                      aria-label={t("lexicon.relatedHeading", { name: relatedTerm.name })}
                    >
                      <div className="section-heading">
                        <h3>{t("lexicon.relatedHeading", { name: relatedTerm.name })}</h3>
                        <IconButton
                          label={t("common.close")}
                          onClick={() => store.setState({ related: null })}
                        >
                          <X size={14} aria-hidden />
                        </IconButton>
                      </div>
                      {related.isFetching && <output>{t("lexicon.loading")}</output>}
                      {related.error && (
                        <Notice
                          actions={
                            <Button onClick={() => void related.refetch()}>
                              {t("lexicon.retry")}
                            </Button>
                          }
                        >
                          {errorMessage(related.error)}
                        </Notice>
                      )}
                      {!related.isPending && !related.error && relatedMatches.length === 0 && (
                        <p className="empty-note">{t("lexicon.noRelated")}</p>
                      )}
                      <ul
                        className="lexicon-results"
                        aria-label={t("lexicon.relatedHeading", { name: relatedTerm.name })}
                      >
                        {renderTerms(relatedMatches)}
                      </ul>
                    </section>
                  )}
                </>
              )}
            </div>
          </section>
          <LexiconComposer
            store={store}
            generation={generation}
            profile={profile}
            readOnly={readOnly}
            targetSelector={targetSelector}
            onInsert={onInsert}
            onInserted={onInserted}
            onBusy={(value) => {
              setBusy(value);
              onBusy?.(value);
            }}
          />
        </div>
      )}
    </fieldset>
  );
}
