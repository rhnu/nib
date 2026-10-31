import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import type { ResourceFolder } from "@/bindings/workbench";
import { t, useTranslation } from "@/shared/i18n";
import { Button, IconButton } from "@/shared/ui";

type FolderRowState = {
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  toggle: () => void;
};

/** Traverse the persisted folder hierarchy for both read-only navigation and management. */
export function ResourceFolderTree({
  folders,
  collapsed,
  onCollapsedChange,
  renderRow,
}: {
  folders: ResourceFolder[];
  collapsed: string[];
  onCollapsedChange: (ids: string[]) => void;
  renderRow: (folder: ResourceFolder, state: FolderRowState) => ReactNode;
}) {
  const render = (parentId: string | null, depth = 0): ReactNode =>
    folders
      .filter((folder) => folder.parentId === parentId)
      .map((folder) => {
        const hasChildren = folders.some((child) => child.parentId === folder.id);
        const expanded = !collapsed.includes(folder.id);

        const toggle = () =>
          onCollapsedChange(
            expanded ? [...collapsed, folder.id] : collapsed.filter((id) => id !== folder.id),
          );

        return (
          <div key={folder.id}>
            {renderRow(folder, { depth, expanded, hasChildren, toggle })}
            {expanded && render(folder.id, depth + 1)}
          </div>
        );
      });

  return <div className="resource-folder-tree">{render(null)}</div>;
}

/** Navigation controls contain no mutation, drag or context-menu behaviour. */
export function ResourceFolderControls({
  folder,
  selected,
  expanded,
  hasChildren,
  toggle,
  onSelect,
}: {
  folder: ResourceFolder;
  selected: boolean;
  expanded: boolean;
  hasChildren: boolean;
  toggle: () => void;
  onSelect: () => void;
}) {
  useTranslation();
  return (
    <>
      {hasChildren ? (
        <IconButton
          label={expanded ? t("library.collapseFolder") : t("library.expandFolder")}
          aria-expanded={expanded}
          onClick={toggle}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </IconButton>
      ) : (
        <span className="folder-indent" />
      )}
      <Button
        className="resource-folder-select"
        aria-current={selected ? "location" : undefined}
        onClick={onSelect}
      >
        {selected ? <FolderOpen size={15} /> : <Folder size={15} />}
        <span title={folder.name}>{folder.name}</span>
      </Button>
    </>
  );
}
