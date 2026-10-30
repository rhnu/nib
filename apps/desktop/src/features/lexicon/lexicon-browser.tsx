import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LexiconKind, LexiconTerm } from "@/bindings/lexicon";
import { Button, Field, Modal, Notice, Toggle } from "@/shared/ui";
import { t, useMessageState, useTranslation } from "@/shared/i18n";
import { errorMessage } from "@/shared/host/error";
import { isCurrentLexicon, lexiconApi, lexiconRevision } from "./api";
import { kindLabel, lexiconKinds } from "./labels";
import { LexiconTermRow } from "./lexicon-term-row";
import { LexiconSettings } from "./lexicon-settings";
import { useLexiconStatus } from "./use-lexicon-status";
import "./styles.css";

type SelectedTerm = { term: LexiconTerm; weight: string };

/** This picker returns ordinary text; Chunk/Preset remain the owners of reusable combinations. */
export function LexiconBrowser({
  open,
  onClose,
  onInsert,
  numericWeights,
  negativeWeights,
  bracketWeights,
  readOnly,
  returnFocus,
}: {
  open: boolean;
  onClose: () => void;
  onInsert?: (
    terms: { name: string; weight: number }[],
    generation: string | null,
  ) => Promise<boolean>;
  numericWeights: boolean;
  negativeWeights: boolean;
  bracketWeights: boolean;
  readOnly: boolean;
  returnFocus?: () => HTMLElement | null;
}) {
  useTranslation();
  const status = useLexiconStatus(open);
  const generation = status.data?.generation ?? null;
  const [text, setText] = useState("");
  const [kind, setKind] = useState<LexiconKind | "">("");
  const [semantic, setSemantic] = useState(true);
  const [pausedText, setPausedText] = useState(text);
  const [manager, setManager] = useState(false);
  const [relation, setRelation] = useState<{ generation: string | null; term: LexiconTerm } | null>(
    null,
  );
  const relatedTerm = relation?.generation === generation ? relation.term : null;
  const [selection, setSelection] = useState<{ generation: string | null; terms: SelectedTerm[] }>({
    generation,
    terms: [],
  });
  const [error, setError] = useMessageState();
  const [inserting, setInserting] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setPausedText(text), 350);
    return () => clearTimeout(timer);
  }, [text]);
  const kinds = kind ? [kind] : [];
  const lexical = useQuery({
    queryKey: ["lexicon-search", generation, text, kind, false],
    queryFn: () => lexiconApi.search(text, kinds, false, 60),
    enabled: open && Boolean(generation),
    staleTime: 30_000,
    retry: false,
  });
  const meaning = useQuery({
    queryKey: ["lexicon-search", generation, pausedText, kind, true],
    queryFn: () => lexiconApi.search(pausedText, kinds, true, 30),
    enabled:
      open &&
      Boolean(generation) &&
      Boolean(status.data?.semanticAvailable) &&
      semantic &&
      Boolean(text.trim()) &&
      text === pausedText,
    staleTime: 30_000,
    retry: false,
  });
  const related = useQuery({
    queryKey: ["lexicon-related", generation, relatedTerm?.key, kind],
    queryFn: () => lexiconApi.search("", kinds, false, 20, relatedTerm!.key),
    enabled: open && Boolean(generation) && Boolean(relatedTerm),
    staleTime: 30_000,
    retry: false,
  });
  const revision = lexiconRevision();
  const lexicalMatches =
    lexical.data && isCurrentLexicon(lexical.data.generation, revision) ? lexical.data.matches : [];
  const semanticMatches =
    semantic &&
    text === pausedText &&
    meaning.data &&
    isCurrentLexicon(meaning.data.generation, revision)
      ? meaning.data.matches
      : [];
  const matches = [
    ...lexicalMatches,
    ...semanticMatches.filter(
      (match) => !lexicalMatches.some((other) => other.term.key === match.term.key),
    ),
  ];
  const selected = selection.generation === generation ? selection.terms : [];
  const relatedMatches =
    related.data && isCurrentLexicon(related.data.generation, revision) ? related.data.matches : [];
  const valid =
    selected.length > 0 &&
    selected.every(
      ({ weight }) =>
        Number.isFinite(Number(weight)) &&
        (numericWeights
          ? weight.trim() !== "" && (negativeWeights || Number(weight) >= 0)
          : Number.isInteger(Number(weight)) && Math.abs(Number(weight)) <= 30),
    );

  const toggle = (term: LexiconTerm) => {
    setError("");
    setSelection({
      generation,
      terms: selected.some((item) => item.term.key === term.key)
        ? selected.filter((item) => item.term.key !== term.key)
        : [...selected, { term, weight: numericWeights ? "1" : "0" }],
    });
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title={t("lexicon.title")} wide finalFocus={returnFocus}>
        <fieldset className="lexicon-browser" disabled={inserting}>
          <div className="lexicon-toolbar">
            <Field label={t("lexicon.search")}>
              <input
                value={text}
                onChange={(event) => setText(event.target.value)}
                spellCheck={false}
              />
            </Field>
            <Field label={t("lexicon.all")}>
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value as LexiconKind | "")}
              >
                <option value="">{t("lexicon.all")}</option>
                {lexiconKinds.map((item) => (
                  <option key={item} value={item}>
                    {kindLabel(item)}
                  </option>
                ))}
              </select>
            </Field>
            <Button onClick={() => setManager(true)}>{t("lexicon.manage")}</Button>
          </div>
          <div className="preference-row">
            <span>{t("lexicon.semantic")}</span>
            <Toggle
              label={t("lexicon.semantic")}
              checked={semantic}
              disabled={!status.data?.semanticAvailable}
              onChange={setSemantic}
            />
          </div>
          {status.isPending ? (
            <output>{t("lexicon.loading")}</output>
          ) : status.error ? (
            <Notice
              actions={<Button onClick={() => void status.refetch()}>{t("lexicon.retry")}</Button>}
            >
              {errorMessage(status.error)}
            </Notice>
          ) : !generation ? (
            <p>{t("lexicon.notInstalled")}</p>
          ) : (
            <>
              {!status.data?.semanticAvailable && (
                <p className="generation-muted">{t("lexicon.semanticUnavailable")}</p>
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
              {meaning.error && semantic && text === pausedText && (
                <Notice
                  actions={
                    <Button onClick={() => void meaning.refetch()}>{t("lexicon.retry")}</Button>
                  }
                >
                  {errorMessage(meaning.error)}
                </Notice>
              )}
              {(lexical.isFetching || meaning.isFetching) && (
                <output>{t("lexicon.loading")}</output>
              )}
              {!lexical.isPending &&
                !lexical.isFetching &&
                !meaning.isFetching &&
                matches.length === 0 &&
                !lexical.error && <p>{t("lexicon.noMatches")}</p>}
              <ul className="lexicon-results" aria-label={t("lexicon.title")}>
                {matches.map((match) => (
                  <LexiconTermRow
                    key={match.term.key}
                    match={match}
                    selected={selected.some((item) => item.term.key === match.term.key)}
                    onSelect={toggle}
                    onRelated={(term) => setRelation({ generation, term })}
                  />
                ))}
              </ul>
              {relatedTerm && (
                <section className="lexicon-related">
                  <div className="section-heading">
                    <h3>{t("lexicon.relatedHeading", { name: relatedTerm.name })}</h3>
                    <Button onClick={() => setRelation(null)}>{t("common.close")}</Button>
                  </div>
                  {related.isFetching && <output>{t("lexicon.loading")}</output>}
                  {related.error && (
                    <Notice
                      actions={
                        <Button onClick={() => void related.refetch()}>{t("lexicon.retry")}</Button>
                      }
                    >
                      {errorMessage(related.error)}
                    </Notice>
                  )}
                  {!related.isPending && !related.error && relatedMatches.length === 0 && (
                    <p>{t("lexicon.noRelated")}</p>
                  )}
                  <ul
                    className="lexicon-results"
                    aria-label={t("lexicon.relatedHeading", { name: relatedTerm.name })}
                  >
                    {relatedMatches.map((match) => (
                      <LexiconTermRow
                        key={match.term.key}
                        match={match}
                        selected={selected.some((item) => item.term.key === match.term.key)}
                        onSelect={toggle}
                        onRelated={(term) => setRelation({ generation, term })}
                      />
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
          {selected.length > 0 && (
            <div className="lexicon-selected" aria-label={t("lexicon.selected")}>
              {selected.map((item) => (
                <div key={item.term.key}>
                  <Button
                    onClick={() => toggle(item.term)}
                    aria-label={t("lexicon.select", { name: item.term.name })}
                  >
                    {item.term.name} ×
                  </Button>
                  {(numericWeights || bracketWeights) && (
                    <Field label={numericWeights ? t("lexicon.weight") : t("lexicon.emphasis")}>
                      <input
                        type="number"
                        step={numericWeights ? "0.1" : "1"}
                        min={numericWeights ? (negativeWeights ? undefined : "0") : "-30"}
                        max={numericWeights ? undefined : "30"}
                        value={item.weight}
                        onChange={(event) =>
                          setSelection({
                            generation,
                            terms: selected.map((other) =>
                              other.term.key === item.term.key
                                ? { ...other, weight: event.target.value }
                                : other,
                            ),
                          })
                        }
                      />
                    </Field>
                  )}
                </div>
              ))}
            </div>
          )}
          {readOnly ? (
            <p>{t("lexicon.lookupOnly")}</p>
          ) : (
            <>
              <p className="generation-muted">{t("lexicon.saveHelp")}</p>
              <Button
                disabled={!valid || inserting}
                onClick={async () => {
                  setInserting(true);
                  setError("");
                  try {
                    if (
                      await onInsert?.(
                        selected.map((item) => ({
                          name: item.term.promptText,
                          weight: Number(item.weight),
                        })),
                        generation,
                      )
                    ) {
                      setSelection({ generation, terms: [] });
                      setError("");
                      onClose();
                    } else setError(t("lexicon.staleEditor"));
                  } catch (cause) {
                    setError(cause);
                  } finally {
                    setInserting(false);
                  }
                }}
              >
                {t("lexicon.insert")}
              </Button>
            </>
          )}
          {error && <Notice>{error}</Notice>}
        </fieldset>
      </Modal>
      <Modal open={manager} onClose={() => setManager(false)} title={t("lexicon.manage")}>
        <LexiconSettings />
      </Modal>
    </>
  );
}
