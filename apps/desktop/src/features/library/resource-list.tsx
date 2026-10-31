import { t, useTranslation } from "@/shared/i18n";
import { ActionsMenu, Button, ContextActions, type ActionMenuItem } from "@/shared/ui";
import type { MouseEvent, ReactNode } from "react";
import type { ResourceSummary, ResourceFolder } from "@/bindings/workbench";
import { ResourceCardContent, ResourceColumns, ResourceResults } from "./resource-browser";
import { folderPath } from "./resource-metadata";

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
  directoryItems,
  hasDirectories,
  searchFolders,
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
  directoryItems: ReactNode;
  hasDirectories: boolean;
  searchFolders?: ResourceFolder[];
}) {
  useTranslation();
  return (
    <ResourceResults
      loading={loading}
      queryError={!!queryError}
      empty={!items.length && !hasDirectories}
      filtered={filtered}
      view={view}
    >
      {view === "list" && <ResourceColumns />}
      {directoryItems}
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
              {searchFolders && (
                <span
                  className="resource-result-path"
                  title={folderPath(item.folderId, searchFolders)}
                >
                  {folderPath(item.folderId, searchFolders)}
                </span>
              )}
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
