import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import type { ExploreQuery, ExploreRating } from "@/bindings/explore";
import { lexiconApi, isCurrentLexicon, lexiconRevision } from "@/features/lexicon/api";
import { useLexiconStatus } from "@/features/lexicon/use-lexicon-status";
import { useDebouncedValue } from "@/shared/query/use-debounced-value";
import { Button, HelpMarker, Select } from "@/shared/ui";
import { IconButton } from "@/shared/ui/button";
import { t, useTranslation } from "@/shared/i18n";

/** Danbooru completion inserts canonical tag names, keeping its query syntax intact. */
function TagQuery({
  value,
  onChange,
  disabled,
  exact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  exact?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const last = exact ? value : (value.split(/\s+/).at(-1) ?? "");
  const debounced = useDebouncedValue(last, 180);
  const status = useLexiconStatus();
  const revision = lexiconRevision();
  const completions = useQuery({
    queryKey: ["explore-completions", status.data?.generation, debounced],
    queryFn: () => lexiconApi.search(debounced.replace(/^[-~]/, ""), [], false, 8),
    enabled: !disabled && focused && Boolean(status.data?.generation) && Boolean(debounced.trim()),
    retry: false,
    meta: { downloadableResources: ["lexicon"] },
  });
  const matches =
    completions.data &&
    debounced === last &&
    isCurrentLexicon(completions.data.generation, revision)
      ? completions.data.matches
      : [];
  return (
    <div
      className="explore-query-input"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <input
        ref={input}
        aria-label={t(exact ? "explore.exactTag" : "explore.query")}
        value={value}
        disabled={disabled}
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t(exact ? "explore.exactTagHint" : "explore.queryHint")}
        autoComplete="off"
      />
      {focused && matches.length > 0 && (
        <div className="explore-completions" aria-label={t("explore.completions")}>
          {matches.map(({ term }) => (
            <button
              key={term.key}
              type="button"
              onClick={() => {
                const prefix = !exact && /^[-~]/.test(last) ? last[0] : "";
                onChange(
                  exact
                    ? term.name
                    : `${value.slice(0, value.length - last.length)}${prefix}${term.name} `,
                );
                input.current?.focus();
                setFocused(false);
              }}
            >
              <span>{term.name}</span>
              <span className="muted">{term.translation}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ExploreQueryFields({
  query,
  onChange,
  onSubmit,
  loading,
}: {
  query: ExploreQuery;
  onChange: (query: ExploreQuery) => void;
  onSubmit: () => void;
  loading: boolean;
}) {
  useTranslation();
  const [tag, setTag] = useState("");
  const random = query.source === "novelAi" && query.sort === "random";

  const addTag = () => {
    if (query.source !== "novelAi" || !tag.trim()) return;
    onChange({ ...query, tags: [...new Set([...query.tags, tag.trim()])] });
    setTag("");
  };

  return (
    <form
      className="explore-search-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!random && tag.trim()) addTag();
        onSubmit();
      }}
    >
      <div className="explore-search-row">
        {query.source === "danbooru" ? (
          <TagQuery value={query.tags} onChange={(tags) => onChange({ ...query, tags })} />
        ) : (
          <>
            <TagQuery value={tag} disabled={random} exact onChange={setTag} />
            <Button disabled={random || !tag.trim()} onClick={addTag}>
              {t("explore.addTag")}
            </Button>
            <label className="explore-creator">
              <span>{t("explore.creator")}</span>
              <input
                value={query.creatorId ?? ""}
                disabled={random}
                onChange={(event) =>
                  onChange({ ...query, creatorId: event.target.value.trim() || null })
                }
                placeholder={t("explore.creatorHint")}
              />
            </label>
          </>
        )}
        <Button className="primary" type="submit" disabled={loading}>
          <Search size={15} aria-hidden />
          {t("explore.search")}
        </Button>
      </div>
      <div className="explore-filter-row">
        {query.source === "danbooru" ? (
          <>
            <span className="muted">{t("explore.rating")}</span>
            {(["general", "sensitive", "questionable", "explicit"] as const).map((rating) => (
              <label className="explore-rating" key={rating}>
                <input
                  type="checkbox"
                  checked={query.ratings.includes(rating)}
                  onChange={(event) => {
                    const ratings: ExploreRating[] = event.target.checked
                      ? [...query.ratings, rating]
                      : query.ratings.filter((value) => value !== rating);
                    onChange({ ...query, ratings });
                  }}
                />
                {t(`explore.rating_${rating}`)}
              </label>
            ))}
            <HelpMarker label={t("explore.queryHelpLabel")}>{t("explore.queryHelp")}</HelpMarker>
          </>
        ) : (
          <>
            <label className="explore-inline-field">
              <span>{t("explore.sort")}</span>
              <Select
                value={query.sort}
                onValueChange={(sort) => onChange({ ...query, sort: sort as typeof query.sort })}
                options={(["new", "top", "hot", "random"] as const).map((value) => ({
                  value,
                  label: t(`explore.sort_${value}`),
                }))}
              />
            </label>
            {(query.sort === "top" || query.sort === "hot") && (
              <label className="explore-inline-field">
                <span>{t("explore.period")}</span>
                <Select
                  value={query.period ?? "week"}
                  onValueChange={(period) =>
                    onChange({ ...query, period: period as typeof query.period })
                  }
                  options={(["day", "week", "month"] as const).map((value) => ({
                    value,
                    label: t(`explore.period_${value}`),
                  }))}
                />
              </label>
            )}
            {query.tags.map((name) => (
              <span className={`explore-query-tag ${random ? "muted" : ""}`} key={name}>
                {name}
                <IconButton
                  disabled={random}
                  label={t("explore.removeTag", { tag: name })}
                  onClick={() =>
                    onChange({ ...query, tags: query.tags.filter((value) => value !== name) })
                  }
                >
                  <X size={12} aria-hidden />
                </IconButton>
              </span>
            ))}
            <span className="muted">{t(random ? "explore.randomHelp" : "explore.exactHelp")}</span>
          </>
        )}
      </div>
    </form>
  );
}
