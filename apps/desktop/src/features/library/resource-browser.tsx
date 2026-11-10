import { IconButton, Select, Row, Grid, ButtonGroup } from "@/shared/ui";

import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, LayoutGrid, List } from "lucide-react";
import type { ResourceSort, ResourceSummary } from "@/bindings/workbench";
import { settingValue } from "@/features/prompt/settings";
import { t, useTranslation } from "@/shared/i18n";

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
    <Row
      gap={0}
      as="fieldset"
      className="resource-sort-control [&_>_.select-trigger]:w-[125px] [&_>_.select-trigger]:border-0 [&_>_.select-trigger]:rounded-[var(--radius)_0_0_var(--radius)] [&_>_.icon-button]:border-0 [&_>_.icon-button]:border-l [&_>_.icon-button]:border-line [&_>_.icon-button]:rounded-[0_var(--radius)_var(--radius)_0] m-0 p-0 [min-inline-size:0] flex items-center shrink-0 border border-line rounded-control bg-input"
      aria-label={t("library.sort")}
    >
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
    </Row>
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
      className={`resource-list [&_>_.empty-note]:py-[48px] [&_>_.empty-note]:px-[20px] [&_>_.empty-note]:col-span-full [&_>_.empty-note]:text-center flex-1 p-space-4 overflow-auto min-h-0 ${view === "grid" ? "resource-grid [&_.resource-result-path]:border-t [&_.resource-result-path]:border-line-subtle [&_.resource-result-path]:py-space-2 [&_.resource-result-path]:px-[10px] [&_.resource-cover]:aspect-[4/3] [&_.resource-cover]:rounded-[var(--radius)_var(--radius)_0_0] [&_.resource-row-title]:[padding:9px_10px_var(--space-1)] [&_.resource-row-tags]:[padding:3px_10px_10px] [&_.resource-row-tags]:min-h-[28px] [&_.resource-row-actions]:absolute [&_.resource-row-actions]:top-[5px] [&_.resource-row-actions]:right-[5px] [&_.resource-row-actions]:bg-raised [&_.resource-row-actions]:border [&_.resource-row-actions]:border-line-subtle [&_.resource-row-actions]:rounded-control [&_.resource-row-actions]:opacity-[0] [&_.resource-row:hover_.resource-row-actions]:opacity-[1] [&_.resource-row:focus-within_.resource-row-actions]:opacity-[1] [&_.resource-row.selected_.resource-row-actions]:opacity-[1] [&_.resource-row-title]:block grid grid-cols-[repeat(auto-fill,_minmax(165px,_1fr))] gap-space-4 content-start" : "resource-detail-view [&_.resource-result-path]:[grid-column:2_/_-1] [&_.resource-row]:grid [&_.resource-row]:grid-cols-[minmax(0,_1fr)_32px] [&_.resource-row]:items-center [&_.resource-row]:gap-space-4 [&_.resource-row]:[padding:0_9px_0_0] [&_.resource-row]:mb-space-1 [&_.resource-cover]:w-[34px] [&_.resource-cover]:h-[38px] [&_.resource-cover]:rounded-control [&_.resource-cover_svg]:w-[19px] [&_.resource-card-select]:grid-cols-[34px_minmax(150px,_1.4fr)_minmax(80px,_1fr)_minmax(95px,_1fr)] [&_.resource-card-select]:gap-space-4 [&_.resource-card-select]:items-center [&_.resource-directory-items]:grid-cols-1 [&_.resource-directory-items]:gap-space-1 [&_.resource-directory-item]:min-h-[42px] [&_.resource-card-select]:grid [&_.resource-card-select]:py-[7px] [&_.resource-card-select]:px-[9px]"}`}
      aria-busy={loading}
      aria-label={t("library.title")}
    >
      {loading ? (
        <output className="empty-note text-muted text-label leading-[1.75] m-[3px_0]">
          {t("library.querying")}
        </output>
      ) : queryError ? (
        <p className="empty-note text-muted text-label leading-[1.75] m-[3px_0]">
          {t("library.queryIncomplete")}
        </p>
      ) : empty ? (
        <p className="empty-note text-muted text-label leading-[1.75] m-[3px_0]">
          {filtered ? t("library.noMatches") : t("library.noResources")}
        </p>
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
      <span className="resource-row-title [&_strong]:block [&_strong]:overflow-hidden [&_strong]:whitespace-nowrap [&_strong]:text-ellipsis [&_strong]:text-label [&_strong]:font-medium [&_small]:block [&_small]:overflow-hidden [&_small]:whitespace-nowrap [&_small]:text-ellipsis [&_small]:text-muted [&_small]:text-[10px] [&_small]:mt-[3px] min-w-0">
        <strong title={item.name}>{item.name}</strong>
        <small>
          {item.kind === "chunk" ? t("library.chunk") : t("library.preset")}
          {item.aliases.length ? ` · ${item.aliases.join(", ")}` : ""}
        </small>
        {view === "grid" && item.description && (
          <span className="resource-card-description [margin:5px_0_0] text-muted text-caption [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden min-h-[30px]">
            {item.description}
          </span>
        )}
      </span>
      <Row
        gap={0}
        as="span"
        className="resource-row-tags [&_.tag]:text-[10px] [&_.tag]:py-[1px] [&_.tag]:px-[5px] [&_.tag]:max-w-full [&_.tag]:overflow-hidden [&_.tag]:text-ellipsis flex items-center flex-wrap gap-space-1 min-w-0 overflow-hidden"
      >
        {item.tags.slice(0, view === "grid" ? 3 : 6).map((tag) => (
          <span
            className="tag inline-flex items-center p-[1px_5px] leading-[19px] text-[10px] rounded-control bg-accent-soft text-accent whitespace-nowrap"
            key={tag}
          >
            {tag}
          </span>
        ))}
      </Row>
      {view === "list" && (
        <span className="resource-row-models text-[10px] text-muted overflow-hidden text-ellipsis whitespace-nowrap">
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
    <Grid
      gap={0}
      align="stretch"
      className="resource-list-columns grid grid-cols-[minmax(150px,_1.4fr)_minmax(80px,_1fr)_minmax(95px,_1fr)_32px] gap-space-4 text-muted text-caption [padding:2px_9px_var(--space-3)_53px]"
      aria-hidden
    >
      <span>{t("library.resourceName")}</span>
      <span>{t("library.tags")}</span>
      <span>{t("library.models")}</span>
      <span />
    </Grid>
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
    <ButtonGroup className="button-group">
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
    </ButtonGroup>
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
    <Row
      gap={0}
      className="resource-pagination flex items-center justify-between shrink-0 h-[48px] gap-space-3 py-space-1 px-space-4 border-t border-line-subtle text-caption text-muted"
      aria-label={t("library.pagination")}
    >
      <span className="resource-total shrink-0 whitespace-nowrap">
        {t("library.resultCount", { count: total })}
      </span>
      {children}
      <Row
        gap={0}
        className="resource-page-controls flex items-center gap-space-2 shrink-0 ml-auto whitespace-nowrap"
      >
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
      </Row>
    </Row>
  );
}
