import type { LexiconMatch, LexiconTerm } from "@/bindings/lexicon";
import { Button } from "@/shared/ui";
import { formatNumber, t, useTranslation } from "@/shared/i18n";
import { kindLabel, reasonLabel } from "./labels";

/** Category, provenance and associations stay distinct from editable prompt text. */
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
    <li>
      <label className="lexicon-term-heading">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onSelect(term)}
          aria-label={t("lexicon.select", { name: term.name })}
        />
        <strong>{term.name}</strong>
        {term.translation && <span>{term.translation}</span>}
        <span className="tag">{kindLabel(term.kind)}</span>
        <span className="generation-muted">{reasonLabel(reason)}</span>
      </label>
      {term.description && <p>{term.description}</p>}
      <details>
        <summary>
          {t("lexicon.source")} · {formatNumber(term.postCount)} · {term.source}
        </summary>
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
        <p>{t("lexicon.posts", { count: term.postCount })}</p>
      </details>
      <Button onClick={() => onRelated(term)}>{t("lexicon.viewRelated")}</Button>
    </li>
  );
}
