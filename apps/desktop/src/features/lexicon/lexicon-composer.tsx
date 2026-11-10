import {
  Button,
  Row,
  IconButton,
  Notice,
  notify,
  Col,
  Input,
  Grid,
  ButtonGroup,
} from "@/shared/ui";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "zustand";
import { ArrowDown, ArrowUp, ChevronDown, Copy, X } from "lucide-react";
import type { PromptSyntaxProfile } from "@/bindings/prompt";

import { formatNumber, t, useMessageState, useTranslation } from "@/shared/i18n";
import { errorMessage } from "@/shared/host/error";
import { formatLexiconTerms } from "@/features/prompt/format-runtime";
import {
  lexiconFormatTerms,
  moveLexiconTerm,
  toggleLexiconTerm,
  validLexiconSelection,
  type LexiconSessionStore,
} from "./lexicon-session";
import type { LexiconInsert } from "./lexicon-workspace";

/** Selection order and model-specific emphasis produce ordinary, safely formatted prompt text. */
export function LexiconComposer({
  store,
  generation,
  profile,
  readOnly,
  targetSelector,
  onInsert,
  onInserted,
  onBusy,
}: {
  store: LexiconSessionStore;
  generation: string | null;
  profile?: PromptSyntaxProfile;
  readOnly: boolean;
  targetSelector?: ReactNode;
  onInsert?: LexiconInsert;
  onInserted?: () => void;
  onBusy: (busy: boolean) => void;
}) {
  useTranslation();
  const { selected, invalidated, generation: selectedGeneration } = useStore(store);
  const [error, setError] = useMessageState();
  const [expanded, setExpanded] = useState(true);
  const valid =
    generation !== null &&
    selectedGeneration === generation &&
    validLexiconSelection(selected, profile);
  const terms = profile ? lexiconFormatTerms(selected, profile) : [];
  const preview = useQuery({
    queryKey: ["lexicon-format", profile, terms],
    queryFn: () => formatLexiconTerms(terms, profile!),
    enabled: valid,
    staleTime: Infinity,
    gcTime: 60_000,
    retry: false,
  });
  const ready = valid && preview.isSuccess;
  const weighted = Boolean(profile?.numericWeights || profile?.bracketWeights);

  const insert = async () => {
    if (!onInsert || !ready) return;
    onBusy(true);
    setError("");
    try {
      if (await onInsert(terms, generation)) {
        store.setState({ selected: [] });
        onInserted?.();
      } else setError(t("lexicon.staleEditor"));
    } catch (cause) {
      setError(cause);
    } finally {
      onBusy(false);
    }
  };

  return (
    <Col
      gap={0}
      as="section"
      className="lexicon-composer min-w-0 min-h-0 [border-left:1px_solid_var(--line)] max-[850px]:[flex:0_0_auto] max-[850px]:[border-left:0] max-[850px]:[border-top:1px_solid_var(--line)]"
      aria-label={t("lexicon.combination")}
    >
      <h2 className="lexicon-composer-heading text-body font-semibold py-space-4 px-[14px] text-foreground [&_>_button]:w-full [&_>_button]:justify-start [&_svg]:ml-auto">
        <Button aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {t("lexicon.combination")}
          <span className="count ml-space-3 text-caption text-muted font-[450]">
            {formatNumber(selected.length)}
          </span>
          <ChevronDown size={14} aria-hidden />
        </Button>
      </h2>
      <Col
        gap={4}
        className="lexicon-composer-content min-h-0 flex-1 [padding:0_14px_14px]"
        hidden={!expanded}
      >
        {invalidated && (
          <Notice
            actions={
              <Button onClick={() => store.setState({ invalidated: false })}>
                {t("app.dismissNotice")}
              </Button>
            }
          >
            {t("lexicon.resourceChanged")}
          </Notice>
        )}
        <div className="lexicon-selection-scroll [min-height:70px] [max-height:48%] overflow-auto max-[850px]:[max-height:220px]">
          {selected.length === 0 ? (
            <p className="empty-note text-muted text-label leading-[1.75] m-[3px_0]">
              {t("lexicon.selectHelp")}
            </p>
          ) : (
            <ol
              className="lexicon-selected list-none [margin:0_0_var(--space-3)] p-0 [&_>_li]:py-space-3 [&_>_li]:px-0 [&_>_li]:[border-bottom:1px_solid_var(--line-subtle)]"
              aria-label={t("lexicon.selected")}
            >
              {selected.map((item, index) => (
                <Row align="stretch" as="li" gap={2} key={item.term.key}>
                  <span className="lexicon-order text-muted text-caption [min-width:12px]">
                    {formatNumber(index + 1)}
                  </span>
                  <div className="lexicon-selected-name [&_strong]:font-mono [&_strong]:text-label [&_strong]:font-normal min-w-0 flex-1 [overflow-wrap:anywhere] [&_small]:block [&_small]:text-caption [&_small]:text-muted">
                    <strong>{item.term.name}</strong>
                    {item.term.translation && <small>{item.term.translation}</small>}
                  </div>
                  {weighted && (
                    <Input
                      type="number"
                      className="lexicon-weight [width:62px] shrink-0"
                      aria-label={`${item.term.name} · ${t(profile!.numericWeights ? "lexicon.weight" : "lexicon.emphasis")}`}
                      title={t(profile!.numericWeights ? "lexicon.weight" : "lexicon.emphasis")}
                      aria-invalid={!validLexiconSelection([item], profile)}
                      step={profile!.numericWeights ? "0.1" : "1"}
                      min={
                        profile!.numericWeights
                          ? profile!.negativeWeights
                            ? undefined
                            : "0"
                          : "-30"
                      }
                      max={profile!.numericWeights ? undefined : "30"}
                      value={profile!.numericWeights ? item.weight : item.emphasis}
                      onChange={(event) =>
                        store.setState(({ selected: current }) => ({
                          selected: current.map((other) =>
                            other.term.key === item.term.key
                              ? {
                                  ...other,
                                  [profile!.numericWeights ? "weight" : "emphasis"]:
                                    event.target.value,
                                }
                              : other,
                          ),
                        }))
                      }
                    />
                  )}
                  <Grid
                    align="stretch"
                    gap={0}
                    columns={1}
                    className="lexicon-selection-actions [grid-template-columns:repeat(3,_24px)] [&_>_.icon-button]:[min-width:24px] [&_>_.icon-button]:[width:24px] [&_>_.icon-button]:p-[3px]"
                  >
                    <IconButton
                      label={t("lexicon.moveUp", { name: item.term.name })}
                      disabled={index === 0}
                      onClick={() => moveLexiconTerm(store, index, -1)}
                    >
                      <ArrowUp size={13} aria-hidden />
                    </IconButton>
                    <IconButton
                      label={t("lexicon.moveDown", { name: item.term.name })}
                      disabled={index === selected.length - 1}
                      onClick={() => moveLexiconTerm(store, index, 1)}
                    >
                      <ArrowDown size={13} aria-hidden />
                    </IconButton>
                    <IconButton
                      label={t("lexicon.remove", { name: item.term.name })}
                      onClick={() => toggleLexiconTerm(store, item.term)}
                    >
                      <X size={13} aria-hidden />
                    </IconButton>
                  </Grid>
                </Row>
              ))}
            </ol>
          )}
          {selected.length > 0 && (
            <Button onClick={() => store.setState({ selected: [] })}>{t("lexicon.clear")}</Button>
          )}
        </div>
        <Col
          gap={0}
          className="lexicon-preview [min-height:100px] flex-1 [&_h3]:[margin:0_0_var(--space-2)] [&_pre]:m-0 [&_pre]:p-[9px] [&_pre]:[min-height:90px] [&_pre]:flex-1 [&_pre]:overflow-auto [&_pre]:whitespace-pre-wrap [&_pre]:[overflow-wrap:anywhere] [&_pre]:font-mono [&_pre]:text-label [&_pre]:[border:1px_solid_var(--line)] [&_pre]:rounded-control [&_pre]:bg-background max-[850px]:[&_pre]:[max-height:180px]"
        >
          <h3>{t("lexicon.preview")}</h3>
          <pre aria-label={t("lexicon.preview")}>{ready ? preview.data : ""}</pre>
          {selected.length > 0 && !profile && (
            <p className="help-note text-muted text-caption leading-[1.7] m-[var(--space-4)_0_0]">
              {t("lexicon.profileUnavailable")}
            </p>
          )}
          {selected.length > 0 && profile && !validLexiconSelection(selected, profile) && (
            <p className="danger text-danger" role="alert">
              {t("lexicon.invalidWeight")}
            </p>
          )}
          {valid && preview.isPending && <output>{t("lexicon.formatting")}</output>}
          {valid && preview.error && (
            <Notice
              actions={<Button onClick={() => void preview.refetch()}>{t("lexicon.retry")}</Button>}
            >
              {errorMessage(preview.error)}
            </Notice>
          )}
        </Col>
        <Grid
          align="stretch"
          gap={3}
          columns={1}
          className="lexicon-composer-footer [&_.help-note]:m-0"
        >
          {targetSelector}
          {readOnly && (
            <p className="help-note text-muted text-caption leading-[1.7] m-[var(--space-4)_0_0]">
              {t("lexicon.lookupOnly")}
            </p>
          )}
          <ButtonGroup
            gap={3}
            wrap
            justify="end"
            className="ui-actions flex items-center justify-end flex-wrap gap-space-3 lexicon-output-actions [&_>_button]:flex-1"
          >
            <Button
              disabled={!ready}
              onClick={async () => {
                setError("");
                try {
                  await navigator.clipboard.writeText(preview.data!);
                  notify(() => t("lexicon.copied"), "copy-prompt");
                } catch (cause) {
                  setError(cause);
                }
              }}
            >
              <Copy size={14} aria-hidden />
              {t("lexicon.copy")}
            </Button>
            {!readOnly && onInsert && (
              <Button
                variant="primary"

                disabled={!ready}
                onClick={() => void insert()}
              >
                {t("lexicon.insert")}
              </Button>
            )}
          </ButtonGroup>
          {error && <Notice>{error}</Notice>}
        </Grid>
      </Col>
    </Col>
  );
}
