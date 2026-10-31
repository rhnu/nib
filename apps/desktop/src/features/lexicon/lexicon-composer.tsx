import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "zustand";
import { ArrowDown, ArrowUp, ChevronDown, Copy, X } from "lucide-react";
import type { PromptSyntaxProfile } from "@/bindings/prompt";
import { Button, IconButton, Notice, notify } from "@/shared/ui";
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
    <section className="lexicon-composer" aria-label={t("lexicon.combination")}>
      <h2 className="lexicon-composer-heading">
        <Button aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {t("lexicon.combination")}
          <span className="count">{formatNumber(selected.length)}</span>
          <ChevronDown size={14} aria-hidden />
        </Button>
      </h2>
      <div className="lexicon-composer-content" hidden={!expanded}>
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
        <div className="lexicon-selection-scroll">
          {selected.length === 0 ? (
            <p className="empty-note">{t("lexicon.selectHelp")}</p>
          ) : (
            <ol className="lexicon-selected" aria-label={t("lexicon.selected")}>
              {selected.map((item, index) => (
                <li key={item.term.key}>
                  <span className="lexicon-order">{formatNumber(index + 1)}</span>
                  <div className="lexicon-selected-name">
                    <strong>{item.term.name}</strong>
                    {item.term.translation && <small>{item.term.translation}</small>}
                  </div>
                  {weighted && (
                    <input
                      type="number"
                      className="lexicon-weight"
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
                  <div className="lexicon-selection-actions">
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
                  </div>
                </li>
              ))}
            </ol>
          )}
          {selected.length > 0 && (
            <Button onClick={() => store.setState({ selected: [] })}>{t("lexicon.clear")}</Button>
          )}
        </div>
        <div className="lexicon-preview">
          <h3>{t("lexicon.preview")}</h3>
          <pre aria-label={t("lexicon.preview")}>{ready ? preview.data : ""}</pre>
          {selected.length > 0 && !profile && (
            <p className="help-note">{t("lexicon.profileUnavailable")}</p>
          )}
          {selected.length > 0 && profile && !validLexiconSelection(selected, profile) && (
            <p className="danger" role="alert">
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
        </div>
        <div className="lexicon-composer-footer">
          {targetSelector}
          {readOnly && <p className="help-note">{t("lexicon.lookupOnly")}</p>}
          <div className="ui-actions lexicon-output-actions">
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
              <Button className="primary" disabled={!ready} onClick={() => void insert()}>
                {t("lexicon.insert")}
              </Button>
            )}
          </div>
          {error && <Notice>{error}</Notice>}
        </div>
      </div>
    </section>
  );
}
