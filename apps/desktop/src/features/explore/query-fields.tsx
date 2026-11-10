import { Button, Field, IconButton, HelpMarker, Select, Input, Grid, Row } from "@/shared/ui";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import type { ExploreQuery, ExploreRating } from "@/bindings/explore";
import { lexiconApi, isCurrentLexicon, lexiconRevision } from "@/features/lexicon/api";
import { useLexiconStatus } from "@/features/lexicon/use-lexicon-status";
import { useDebouncedValue } from "@/shared/query/use-debounced-value";

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
      className="explore-query-input relative flex-1 [min-width:150px] [&_>_input]:w-full [&_>_input]:font-mono max-[960px]:[flex-basis:45%]"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <Input
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
        <div
          className="explore-completions absolute [z-index:12] [top:calc(100%_+_4px)] [left:0] [right:0] p-space-1 [border:1px_solid_var(--line)] rounded-overlay bg-raised [box-shadow:var(--shadow)] [&_button]:flex [&_button]:justify-between [&_button]:gap-space-3 [&_button]:w-full [&_button]:[border:0] [&_button]:py-[5px] [&_button]:px-space-3 [&_button]:text-left [&_button]:[background:transparent] [&_button:hover]:bg-hover [&_button:focus-visible]:bg-hover"
          aria-label={t("explore.completions")}
        >
          {matches.map(({ term }) => (
            <Button
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
              <span className="muted text-muted">{term.translation}</span>
            </Button>
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
    <Grid
      align="stretch"
      gap={0}
      columns={1}
      as="form"
      className="explore-search-form gap-[10px]"
      onSubmit={(event) => {
        event.preventDefault();
        if (!random && tag.trim()) addTag();
        onSubmit();
      }}
    >
      <Row
        gap={0}
        align="center"
        className="explore-search-row gap-[10px] [&_>_button[type=submit]]:shrink-0 [&_>_button[type=submit]]:min-w-[84px] max-[960px]:flex-wrap"
      >
        {query.source === "danbooru" ? (
          <TagQuery value={query.tags} onChange={(tags) => onChange({ ...query, tags })} />
        ) : (
          <>
            <TagQuery value={tag} disabled={random} exact onChange={setTag} />
            <Button disabled={random || !tag.trim()} onClick={addTag}>
              {t("explore.addTag")}
            </Button>
            <Field
              label={t("explore.creator")}
              className="grid-cols-[auto_minmax(0,1fr)] items-center gap-space-2 [&_.select-trigger]:min-w-[100px]"
            >
              <Input
                autoComplete="off"
                value={query.creatorId ?? ""}
                disabled={random}
                onChange={(event) =>
                  onChange({ ...query, creatorId: event.target.value.trim() || null })
                }
                placeholder={t("explore.creatorHint")}
              />
            </Field>
          </>
        )}
        <Button variant="primary" type="submit" disabled={loading}>
          <Search size={15} aria-hidden />
          {t("explore.search")}
        </Button>
      </Row>
      <Row
        gap={0}
        align="center"
        wrap
        className="explore-filter-row gap-[10px] [min-height:26px] text-label"
      >
        {query.source === "danbooru" ? (
          <>
            <span className="muted text-muted">{t("explore.rating")}</span>
            {(["general", "sensitive", "questionable", "explicit"] as const).map((rating) => (
              <Row
                gap={2}
                align="center"
                as="label"
                className="explore-rating [&_input]:[accent-color:var(--accent)] inline-flex"
                key={rating}
              >
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
              </Row>
            ))}
            <HelpMarker label={t("explore.queryHelpLabel")}>{t("explore.queryHelp")}</HelpMarker>
          </>
        ) : (
          <>
            <Field
              label={t("explore.sort")}
              className="grid-cols-[auto_minmax(0,1fr)] items-center gap-space-2 [&_.select-trigger]:min-w-[100px]"
            >
              <Select
                value={query.sort}
                onValueChange={(sort) => onChange({ ...query, sort: sort as typeof query.sort })}
                options={(["new", "top", "hot", "random"] as const).map((value) => ({
                  value,
                  label: t(`explore.sort_${value}`),
                }))}
              />
            </Field>
            {(query.sort === "top" || query.sort === "hot") && (
              <Field
                label={t("explore.period")}
                className="grid-cols-[auto_minmax(0,1fr)] items-center gap-space-2 [&_.select-trigger]:min-w-[100px]"
              >
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
              </Field>
            )}
            {query.tags.map((name) => (
              <Row
                gap={0}
                as="span"
                className={`explore-query-tag items-center gap-space-1 [max-width:100%] py-[2px] px-space-2 [border:1px_solid_var(--line)] rounded-control bg-raised [overflow-wrap:anywhere] [&_.icon-button]:[width:20px] [&_.icon-button]:[height:20px] [&_.icon-button]:[min-width:20px] [&_.icon-button]:p-0 [&_.icon-button]:[border:0] ${random ? "muted text-muted" : ""}`}
                key={name}
              >
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
              </Row>
            ))}
            <span className="muted text-muted">
              {t(random ? "explore.randomHelp" : "explore.exactHelp")}
            </span>
          </>
        )}
      </Row>
    </Grid>
  );
}
