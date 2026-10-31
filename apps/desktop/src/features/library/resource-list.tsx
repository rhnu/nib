import { t, useTranslation } from "@/shared/i18n";
import { ActionsMenu, Button, ContextActions, type ActionMenuItem } from "@/shared/ui";
import type { MouseEvent } from "react";
import type { ResourceSummary } from "@/bindings/workbench";
import { ResourceCardContent, ResourceColumns, ResourceResults } from "./resource-browser";

export const resourceDragType = "application/x-nib-resource-selection";

/** Grid and detail views share selection, drag payload and the same resource actions. */
export function ResourceList({
  loading,
  queryError,
  items,
  filtered,
  selectedIds,
  view,
  onSelect,
  onActivate,
  actions,
  onContextSelect,
}: {
  loading: boolean;
  queryError: string;
  items: ResourceSummary[];
  filtered: boolean;
  selectedIds: string[];
  view: "grid" | "list";
  onSelect: (id: string, event: MouseEvent) => void;
  onActivate: (id: string) => void;
  actions: (resource: ResourceSummary) => ActionMenuItem[];
  onContextSelect: (id: string) => void;
}) {
  useTranslation();
  return (
    <ResourceResults
      loading={loading}
      queryError={!!queryError}
      empty={!items.length}
      filtered={filtered}
      view={view}
    >
      {view === "list" && <ResourceColumns />}
      {items.map((item) => (
        <ContextActions key={item.id} items={actions(item)} onOpen={() => onContextSelect(item.id)}>
          <div
            className={`resource-row ${selectedIds.includes(item.id) ? "selected" : ""}`}
            draggable
            onDragStart={(event) => {
              const selected = selectedIds.includes(item.id)
                ? items.filter((value) => selectedIds.includes(value.id))
                : [item];
              onContextSelect(item.id);
              event.dataTransfer.setData(
                resourceDragType,
                JSON.stringify({
                  resources: selected.map(({ id }) => id),
                  folders: [],
                }),
              );
              event.dataTransfer.effectAllowed = "copyMove";
            }}
          >
            <Button
              className="resource-card-select"
              aria-pressed={selectedIds.includes(item.id)}
              onClick={(event) => onSelect(item.id, event)}
              onDoubleClick={() => onActivate(item.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onActivate(item.id);
                }
              }}
            >
              <ResourceCardContent item={item} view={view} />
            </Button>
            <div className="resource-row-actions">
              <ActionsMenu label={t("library.manageResource")} items={actions(item)} />
            </div>
          </div>
        </ContextActions>
      ))}
    </ResourceResults>
  );
}
