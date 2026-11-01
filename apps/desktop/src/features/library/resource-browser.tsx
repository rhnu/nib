import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, LayoutGrid, List } from "lucide-react";
import type { ResourceSort, ResourceSummary } from "@/bindings/workbench";
import { settingValue } from "@/features/prompt/settings";
import { t, useTranslation } from "@/shared/i18n";
import { IconButton, Select } from "@/shared/ui";
import { ResourceCover } from "./resource-cover";

export type ResourceView = "grid" | "list";

/** A single outlined group owns both the sort key and its direction. */
export function ResourceSortControl({
  sort,
  descending,
  onChange,
}: {
  sort: ResourceSort;
  descending: boolean;
  onChange: (patch: Partial<{ sort: ResourceSort; descending: boolean }>) => void;
}) {
  useTranslation();
  return (
    <fieldset className="resource-sort-control" aria-label={t("library.sort")}>
      <Select
        aria-label={t("library.sort")}
        value={sort}
        onValueChange={(sort) => onChange({ sort: sort as ResourceSort })}
        options={[
          { value: "name", label: t("library.resourceName") },
          { value: "updatedAt", label: t("library.updated") },
          { value: "createdAt", label: t("library.created") },
        ]}
      />
      <IconButton
        label={descending ? t("library.descending") : t("library.ascending")}
        onClick={() => onChange({ descending: !descending })}
      >
        {descending ? <ArrowDown size={15} /> : <ArrowUp size={15} />}
      </IconButton>
    </fieldset>
  );
}

/** Shared catalogue states and scrolling layout; callers own selection and available actions. */
export function ResourceResults({
  loading,
  queryError,
  empty,
  filtered,
  view,
  children,
}: {
  loading: boolean;
  queryError: boolean;
  empty: boolean;
  filtered: boolean;
  view: ResourceView;
  children: ReactNode;
}) {
  useTranslation();
  return (
    <div
      className={`resource-list ${view === "grid" ? "resource-grid" : "resource-detail-view"}`}
      aria-busy={loading}
      aria-label={t("library.title")}
    >
      {loading ? (
        <output className="empty-note">{t("library.querying")}</output>
      ) : queryError ? (
        <p className="empty-note">{t("library.queryIncomplete")}</p>
      ) : empty ? (
        <p className="empty-note">{filtered ? t("library.noMatches") : t("library.noResources")}</p>
      ) : (
        children
      )}
    </div>
  );
}

/** The same resource summary is used by management cards and insertion choices. */
export function ResourceCardContent({ item, view }: { item: ResourceSummary; view: ResourceView }) {
  useTranslation();
  return (
    <>
      <ResourceCover assetId={item.coverAssetId} name={item.name} kind={item.kind} />
      <span className="resource-row-title">
        <strong title={item.name}>{item.name}</strong>
        <small>
          {item.kind === "chunk" ? t("library.chunk") : t("library.preset")}
          {item.aliases.length ? ` · ${item.aliases.join(", ")}` : ""}
        </small>
        {view === "grid" && item.description && (
          <span className="resource-card-description">{item.description}</span>
        )}
      </span>
      <span className="resource-row-tags">
        {item.tags.slice(0, view === "grid" ? 3 : 6).map((tag) => (
          <span className="tag" key={tag}>
            {tag}
          </span>
        ))}
      </span>
      {view === "list" && (
        <span className="resource-row-models">
          {item.models.length
            ? item.models.map((model) => settingValue("model", model)).join(", ")
            : t("library.unrestricted")}
        </span>
      )}
    </>
  );
}

export function ResourceColumns() {
  useTranslation();
  return (
    <div className="resource-list-columns" aria-hidden>
      <span>{t("library.resourceName")}</span>
      <span>{t("library.tags")}</span>
      <span>{t("library.models")}</span>
      <span />
    </div>
  );
}

export function ResourceViewSwitch({
  view,
  onChange,
}: {
  view: ResourceView;
  onChange: (view: ResourceView) => void;
}) {
  useTranslation();
  return (
    <div className="button-group">
      <IconButton
        label={t("library.gridView")}
        aria-pressed={view === "grid"}
        onClick={() => onChange("grid")}
      >
        <LayoutGrid size={15} />
      </IconButton>
      <IconButton
        label={t("library.listView")}
        aria-pressed={view === "list"}
        onClick={() => onChange("list")}
      >
        <List size={15} />
      </IconButton>
    </div>
  );
}

export function ResourcePagination({
  offset,
  total,
  pageSize,
  loading,
  onChange,
  children,
}: {
  offset: number;
  total: number;
  pageSize: number;
  loading: boolean;
  onChange: (offset: number) => void;
  children?: ReactNode;
}) {
  useTranslation();
  return (
    <div className="resource-pagination" aria-label={t("library.pagination")}>
      <span className="resource-total">{t("library.resultCount", { count: total })}</span>
      {children}
      <div className="resource-page-controls">
        <IconButton
          label={t("library.previousPage")}
          disabled={offset === 0 || loading}
          onClick={() => onChange(Math.max(0, offset - pageSize))}
        >
          <ChevronLeft size={15} />
        </IconButton>
        <span aria-live="polite">
          {total ? `${offset + 1}–${Math.min(offset + pageSize, total)} / ${total}` : "0"}
        </span>
        <IconButton
          label={t("library.nextPage")}
          disabled={offset + pageSize >= total || loading}
          onClick={() => onChange(offset + pageSize)}
        >
          <ChevronRight size={15} />
        </IconButton>
      </div>
    </div>
  );
}
