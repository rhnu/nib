import { ActionsMenu, Button, ContextActions, type ActionMenuItem, Col, Row } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";
import { useRef, useEffect, type DragEvent, type ReactElement } from "react";
import { FolderRoot } from "lucide-react";
import type { ResourceFolder, ResourceSelection } from "@/bindings/workbench";

import { resourceDragType } from "./resource-list";
import { ResourceFolderControls, ResourceFolderTree } from "./resource-folder-tree";

/** Read-only navigation has no context-menu trigger or mutation shortcuts. */
function FolderContext({ items, children }: { items?: ActionMenuItem[]; children: ReactElement }) {
  return items ? <ContextActions items={items}>{children}</ContextActions> : children;
}

/** Organize folders in their own pane; ordinary actions also cover every drag operation. */
export function ResourceFolders({
  folders,
  folderId,
  collapsed,
  onCollapsedChange,
  onSelect,
  actions,
  onRename,
  onDropSelection,
}: {
  folders: ResourceFolder[];
  folderId: string | null;
  collapsed: string[];
  onCollapsedChange: (ids: string[]) => void;
  onSelect: (id: string | null) => void;
  actions?: (folder: ResourceFolder | null) => ActionMenuItem[];
  onRename?: (folder: ResourceFolder) => void;
  onDropSelection?: (selection: ResourceSelection, folderId: string | null, copy: boolean) => void;
}) {
  useTranslation();
  const element = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = element.current;
    if (!root) return;

    const keydown = (event: KeyboardEvent) => {
      if (!onRename || event.key !== "F2" || !(event.target instanceof Element)) return;
      const row = event.target.closest<HTMLElement>("[data-folder-id]");
      const folder = folders.find((folder) => folder.id === row?.dataset.folderId);
      if (folder) {
        event.preventDefault();
        event.stopPropagation();
        onRename(folder);
      }
    };

    root.addEventListener("keydown", keydown);
    return () => root.removeEventListener("keydown", keydown);
  });

  const drop = (event: DragEvent, id: string | null) => {
    if (!onDropSelection || !event.dataTransfer.types.includes(resourceDragType)) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      onDropSelection(
        JSON.parse(event.dataTransfer.getData(resourceDragType)) as ResourceSelection,
        id,
        event.ctrlKey,
      );
    } catch {
      /* Foreign drag payloads are ignored. */
    }
  };

  const accepts = (event: DragEvent) => {
    if (onDropSelection && event.dataTransfer.types.includes(resourceDragType)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = event.ctrlKey ? "copy" : "move";
    }
  };

  return (
    <Col
      gap={0}
      align="stretch"
      as="aside"
      ref={element}
      className="resource-folders flex flex-col min-h-0 p-[var(--space-3)_var(--space-2)] [border-right:1px_solid_var(--line-subtle)] overflow-auto [&_>_header]:mb-space-3 [&_>_header]:py-0 [&_>_header]:px-[7px] py-space-3 px-space-2 border-r border-line-subtle"
      aria-label={t("library.folders")}
    >
      <Row
        align="center"
        justify="between"
        gap={3}
        as="header"
        className="ui-heading flex items-center justify-between gap-space-3 min-w-0 min-h-control [&_>_:is(h2,_h3)]:m-0 [&_>_:is(h2,_h3)]:min-w-0 [&_>_:is(h2,_h3)]:text-section [&_>_:is(h2,_h3)]:font-semibold"
      >
        <strong>{t("library.folders")}</strong>
      </Row>
      <FolderContext items={actions?.(null)}>
        <div onDragOver={accepts} onDrop={(event) => drop(event, null)}>
          <Button
            className={`resource-folder-root [&.selected]:bg-accent-soft [&.selected:hover]:bg-accent-soft [&:hover]:bg-hover flex justify-start w-full py-0 px-[10px] border-0 bg-transparent gap-space-3 mb-[2px] ${!folderId ? "selected" : ""}`}
            aria-current={!folderId ? "location" : undefined}
            onClick={() => onSelect(null)}
          >
            <FolderRoot size={15} />
            {t("library.rootFolder")}
          </Button>
        </div>
      </FolderContext>
      <ResourceFolderTree
        folders={folders}
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
        renderRow={(folder, { depth, expanded, hasChildren, toggle }) => (
          <FolderContext items={actions?.(folder)}>
            <Row
              gap={0}
              data-folder-id={folder.id}
              className={`resource-folder-row [&:hover]:bg-hover [&.selected]:bg-accent-soft [&.selected:hover]:bg-accent-soft [&_>_.icon-button]:w-[22px] [&_>_.icon-button]:min-w-[22px] [&_>_.icon-button]:p-0 [&_>_[data-base-ui-menu-trigger]]:ml-auto flex items-center gap-0 min-h-[32px] rounded-control ${folder.id === folderId ? "selected" : ""}`}
              style={{ paddingLeft: 8 + depth * 15 }}
              onDragOver={accepts}
              onDrop={(event) => drop(event, folder.id)}
              draggable={!!onDropSelection}
              onDragStart={(event) => {
                event.stopPropagation();
                event.dataTransfer.effectAllowed = "copyMove";
                event.dataTransfer.setData(
                  resourceDragType,
                  JSON.stringify({
                    resources: [],
                    folders: [folder.id],
                  }),
                );
              }}
            >
              <ResourceFolderControls
                folder={folder}
                selected={folder.id === folderId}
                expanded={expanded}
                hasChildren={hasChildren}
                toggle={toggle}
                onSelect={() => onSelect(folder.id)}
              />
              {actions && <ActionsMenu label={t("library.manageFolder")} items={actions(folder)} />}
            </Row>
          </FolderContext>
        )}
      />
    </Col>
  );
}
