import {
  Button,
  Toolbar,
  HelpMarker,
  IconButton,
  Notice,
  Col,
  Row,
  Input,
  Grid,
  ButtonGroup,
} from "@/shared/ui";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LexiconFormatTerm, PromptSyntaxProfile } from "@/bindings/prompt";
import { BookOpen, Search, X } from "lucide-react";

import { t, useTranslation } from "@/shared/i18n";
import { errorMessage } from "@/shared/host/error";
import { kindLabel, lexiconKinds } from "./labels";
import { toggleLexiconTerm, type LexiconSessionStore } from "./lexicon-session";
import { LexiconTermRow } from "./lexicon-term-row";
import { LexiconComposer } from "./lexicon-composer";
import { useLexiconSearch } from "./use-lexicon-search";

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
    <Col
      gap={0}
      as="fieldset"
      className="lexicon-workspace flex-1 min-h-0 min-w-0"
      disabled={busy}
      aria-label={t("lexicon.title")}
    >
      <Toolbar
        gap={3}
        align="center"
        wrap
        className="lexicon-toolbar py-[10px] px-[14px] [border-bottom:1px_solid_var(--line)]"
      >
        <div className="lexicon-search-field relative flex-1 [min-width:200px] [&_>_svg]:absolute [&_>_svg]:[left:9px] [&_>_svg]:[top:8px] [&_>_svg]:text-muted [&_>_input]:pl-[31px]">
          <Search size={15} aria-hidden />
          <Input
            autoComplete="off"
            aria-label={t("lexicon.search")}
            placeholder={t("lexicon.search")}
            value={state.text}
            onChange={(event) => store.setState({ text: event.target.value })}
            spellCheck={false}
          />
        </div>
        <Row
          gap={0}
          align="stretch"
          as="fieldset"
          className="lexicon-modes gap-[2px] [&_>_button[aria-pressed='true']]:[background:var(--accent-soft)] [&_>_button[aria-pressed='true']]:text-accent [&_>_button[aria-pressed='true']]:[border-color:var(--accent)]"
          aria-label={t("lexicon.searchMode")}
        >
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
        </Row>
        {generation && !status.data?.semanticAvailable && (
          <HelpMarker label={t("lexicon.semantic")}>{semanticHint}</HelpMarker>
        )}
      </Toolbar>
      {notInstalled ? (
        <Col
          gap={5}
          align="center"
          justify="center"
          as="section"
          className="lexicon-empty flex-1 [min-height:240px] py-[32px] px-[20px] text-center [&_>_svg]:text-muted"
          aria-label={t("lexicon.results")}
        >
          <BookOpen size={32} aria-hidden />
          <h2>{t("lexicon.notInstalled")}</h2>
          <Button variant="primary" onClick={onOpenDownloads}>
            {t("lexicon.openDownloads")}
          </Button>
        </Col>
      ) : (
        <Grid
          align="stretch"
          gap={0}
          columns={1}
          className="lexicon-body [grid-template-columns:minmax(0,_1fr)_clamp(320px,_30%,_420px)] flex-1 min-h-0 max-[850px]:flex max-[850px]:flex-col max-[850px]:overflow-auto"
        >
          <Col
            gap={0}
            as="section"
            className="lexicon-browse min-h-0 min-w-0 max-[850px]:[flex:1_0_260px] max-[850px]:[max-height:60dvh]"
            aria-label={t("lexicon.results")}
          >
            <Row
              gap={0}
              align="stretch"
              wrap
              as="fieldset"
              className="lexicon-kinds gap-[2px] [&_>_button[aria-pressed='true']]:[background:var(--accent-soft)] [&_>_button[aria-pressed='true']]:text-accent [&_>_button[aria-pressed='true']]:[border-color:var(--accent)] py-space-3 px-[14px] [border-bottom:1px_solid_var(--line-subtle)] [&_>_button]:[border-color:transparent] [&_>_button]:[background:transparent]"
              aria-label={t("lexicon.all")}
            >
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
            </Row>
            <div className="lexicon-browse-scroll overflow-auto min-h-0 flex-1 [padding:0_14px_14px] [&_>_.empty-note]:py-[20px] [&_>_.empty-note]:px-0">
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
                        <ButtonGroup
                          gap={3}
                          wrap
                          justify="end"
                          className="ui-actions flex items-center justify-end flex-wrap gap-space-3"
                        >
                          <Button onClick={() => void meaning.refetch()}>
                            {t("lexicon.retry")}
                          </Button>
                          <Button onClick={onOpenDownloads}>{t("lexicon.openDownloads")}</Button>
                        </ButtonGroup>
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
                      <p className="empty-note text-muted text-label leading-[1.75] m-[3px_0]">
                        {t("lexicon.noMatches")}
                      </p>
                    )}
                  <ul
                    className="lexicon-results list-none m-0 p-0 [&_>_li]:py-[7px] [&_>_li]:px-space-1 [&_>_li]:[border-bottom:1px_solid_var(--line-subtle)] [&_>_li.selected]:[background:var(--accent-soft)] [&_>_li_>_.icon-button]:mt-[1px] [&_>_li.selected_>_.icon-button]:text-accent"
                    aria-label={t("lexicon.results")}
                    aria-busy={loading}
                  >
                    {renderTerms(matches)}
                  </ul>
                  {relatedTerm && (
                    <section
                      ref={relatedRef}
                      className="lexicon-related mt-space-5 pt-space-3 [border-top:1px_solid_var(--line)]"
                      aria-label={t("lexicon.relatedHeading", { name: relatedTerm.name })}
                    >
                      <Row
                        gap={0}
                        align="center"
                        justify="between"
                        className="flex items-center justify-between gap-space-3 min-w-0 min-h-control mb-space-2 [&_>_:is(h2,_h3)]:m-0 [&_>_:is(h2,_h3)]:min-w-0 [&_>_:is(h2,_h3)]:text-section [&_>_:is(h2,_h3)]:font-semibold"
                      >
                        <h3>{t("lexicon.relatedHeading", { name: relatedTerm.name })}</h3>
                        <IconButton
                          label={t("common.close")}
                          onClick={() => store.setState({ related: null })}
                        >
                          <X size={14} aria-hidden />
                        </IconButton>
                      </Row>
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
                        <p className="empty-note text-muted text-label leading-[1.75] m-[3px_0]">
                          {t("lexicon.noRelated")}
                        </p>
                      )}
                      <ul
                        className="lexicon-results list-none m-0 p-0 [&_>_li]:py-[7px] [&_>_li]:px-space-1 [&_>_li]:[border-bottom:1px_solid_var(--line-subtle)] [&_>_li.selected]:[background:var(--accent-soft)] [&_>_li_>_.icon-button]:mt-[1px] [&_>_li.selected_>_.icon-button]:text-accent"
                        aria-label={t("lexicon.relatedHeading", { name: relatedTerm.name })}
                      >
                        {renderTerms(relatedMatches)}
                      </ul>
                    </section>
                  )}
                </>
              )}
            </div>
          </Col>
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
        </Grid>
      )}
    </Col>
  );
}
