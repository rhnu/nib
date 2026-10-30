import { Check, Plus } from "lucide-react";
import type { LexiconMatch, LexiconTerm } from "@/bindings/lexicon";
import { Button, IconButton } from "@/shared/ui";
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
    <li className={selected ? "selected" : ""}>
      <IconButton
        label={t(selected ? "lexicon.remove" : "lexicon.select", { name: term.name })}
        aria-pressed={selected}
        onClick={() => onSelect(term)}
      >
        {selected ? <Check size={15} /> : <Plus size={15} />}
      </IconButton>
      <details className="lexicon-term-details">
        <summary>
          <strong>{term.name}</strong>
          {term.translation && <span className="lexicon-translation">{term.translation}</span>}
          <span className="tag">{kindLabel(term.kind)}</span>
          <span className="lexicon-match-reason">{reasonLabel(reason)}</span>
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
        <p className="muted">
          {t("lexicon.posts", { count: term.postCount })} · {t("lexicon.source")}: {term.source}
        </p>
        <Button onClick={() => onRelated(term)}>{t("lexicon.viewRelated")}</Button>
      </details>
    </li>
  );
}
