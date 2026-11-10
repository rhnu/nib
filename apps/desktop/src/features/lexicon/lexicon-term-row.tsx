import { Button, Row, IconButton } from "@/shared/ui";

import { Check, Plus } from "lucide-react";
import type { LexiconMatch, LexiconTerm } from "@/bindings/lexicon";

import { t, useTranslation } from "@/shared/i18n";
import { kindLabel, reasonLabel } from "./labels";

/** Browsing stays compact; descriptions and provenance are available per term. */
export function LexiconTermRow({
  match: { term, reason },
  selected,
  onSelect,
  onRelated,
}: {
  match: LexiconMatch;
  selected: boolean;
  onSelect: (term: LexiconTerm) => void;
  onRelated: (term: LexiconTerm) => void;
}) {
  useTranslation();
  return (
    <Row as="li" gap={3} align="start" className={selected ? "selected" : ""}>
      <IconButton
        label={t(selected ? "lexicon.remove" : "lexicon.select", { name: term.name })}
        aria-pressed={selected}
        onClick={() => onSelect(term)}
      >
        {selected ? <Check size={15} /> : <Plus size={15} />}
      </IconButton>
      <details className="lexicon-term-details min-w-0 flex-1 [&_>_summary]:py-[5px] [&_>_summary]:px-0 [&_>_summary]:cursor-pointer [&_>_summary]:text-foreground [&_>_summary]:[overflow-wrap:anywhere] [&_>_summary_>_*]:mr-[10px] [&_strong]:font-mono [&_strong]:text-label [&_strong]:font-normal [&_p]:my-space-2 [&_p]:mx-0 [&_p]:text-label">
        <summary>
          <strong>{term.name}</strong>
          {term.translation && (
            <span className="lexicon-translation text-muted text-caption">{term.translation}</span>
          )}
          <span className="tag inline-flex items-center p-[1px_5px] leading-[19px] text-[10px] rounded-control bg-accent-soft text-accent whitespace-nowrap">
            {kindLabel(term.kind)}
          </span>
          <span className="lexicon-match-reason text-muted text-caption">
            {reasonLabel(reason)}
          </span>
        </summary>
        {term.description && <p>{term.description}</p>}
        {term.aliases.length > 0 && (
          <p>
            {t("lexicon.aliases")}: {term.aliases.join(", ")}
          </p>
        )}
        {term.groups.length > 0 && (
          <p>
            {t("lexicon.groups")}: {term.groups.join(" · ")}
          </p>
        )}
        <p className="muted text-muted">
          {t("lexicon.posts", { count: term.postCount })} · {t("lexicon.source")}: {term.source}
        </p>
        <Button onClick={() => onRelated(term)}>{t("lexicon.viewRelated")}</Button>
      </details>
    </Row>
  );
}
