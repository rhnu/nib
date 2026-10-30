import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LexiconFormatTerm, PromptSyntaxProfile } from "@/bindings/prompt";
import { Search, Settings2, X } from "lucide-react";
import { Button, IconButton, Modal, Notice } from "@/shared/ui";
import { t, useTranslation } from "@/shared/i18n";
import { errorMessage } from "@/shared/host/error";
import { DownloadsSettings } from "@/features/downloads/downloads-settings";
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
}: {
  store: LexiconSessionStore;
  profile?: PromptSyntaxProfile;
  readOnly?: boolean;
  onInsert?: LexiconInsert;
  onInserted?: () => void;
  onBusy?: (busy: boolean) => void;
  targetSelector?: ReactNode;
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
  const [manager, setManager] = useState(false);
  const [busy, setBusy] = useState(false);
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
    <>
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
              title={!status.data?.semanticAvailable ? t("lexicon.semanticUnavailable") : undefined}
              onClick={() => store.setState({ mode: "semantic" })}
            >
              {t("lexicon.semantic")}
            </Button>
          </fieldset>
          <Button onClick={() => setManager(true)}>
            <Settings2 size={14} aria-hidden />
            {t("lexicon.manage")}
          </Button>
        </div>
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
              {status.isPending ? (
                <output>{t("lexicon.loading")}</output>
              ) : status.error ? (
                <Notice
                  actions={
                    <Button onClick={() => void status.refetch()}>{t("lexicon.retry")}</Button>
                  }
                >
                  {errorMessage(status.error)}
                </Notice>
              ) : !generation ? (
                <p className="empty-note">{t("lexicon.notInstalled")}</p>
              ) : (
                <>
                  {!status.data?.semanticAvailable && (
                    <p className="help-note lexicon-status-note">
                      {t("lexicon.semanticUnavailable")}
                    </p>
                  )}
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
                        <Button onClick={() => void meaning.refetch()}>{t("lexicon.retry")}</Button>
                      }
                    >
                      {errorMessage(meaning.error)}
                    </Notice>
                  )}
                  {loading && <output>{t("lexicon.loading")}</output>}
                  {!lexical.isPending &&
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
      </fieldset>
      <Modal
        open={manager}
        onClose={() => setManager(false)}
        title={t("downloads.title")}
        wide
        className="resource-manager-modal"
      >
        <DownloadsSettings />
      </Modal>
    </>
  );
}
