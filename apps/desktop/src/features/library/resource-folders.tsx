import { t, useTranslation } from "@/shared/i18n";
import { useRef, useEffect, type DragEvent } from "react";
import { Layers, Inbox } from "lucide-react";
import type { ResourceFolder, ResourceSelection } from "@/bindings/workbench";
import { ActionsMenu, Button, ContextActions, type ActionMenuItem } from "@/shared/ui";
import { useStore } from "zustand";
import { useLibrarySessionStore } from "./model/library-session-context";
import { resourceDragType } from "./resource-list";
import { ResourceFolderControls, ResourceFolderTree } from "./resource-folder-tree";

/** Organize folders in their own pane; ordinary actions also cover every drag operation. */
export function ResourceFolders({
  folders,
  folderId,
  rootOnly,
  onSelect,
  actions,
  onRename,
  onDropSelection,
}: {
  folders: ResourceFolder[];
  folderId: string | null;
  rootOnly: boolean;
  onSelect: (id: string | null, rootOnly?: boolean) => void;
  actions: (folder: ResourceFolder | null) => ActionMenuItem[];
  onRename: (folder: ResourceFolder) => void;
  onDropSelection: (selection: ResourceSelection, folderId: string | null, copy: boolean) => void;
}) {
  useTranslation();
  const element = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = element.current;
    if (!root) return;

    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "F2" || !(event.target instanceof Element)) return;
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
  const store = useLibrarySessionStore();
  const collapsed = useStore(store, (state) => state.collapsedFolders);

  const setCollapsed = (collapsedFolders: string[]) => store.setState({ collapsedFolders });

  const drop = (event: DragEvent, id: string | null) => {
    if (!event.dataTransfer.types.includes(resourceDragType)) return;
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
    if (event.dataTransfer.types.includes(resourceDragType)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = event.ctrlKey ? "copy" : "move";
    }
  };

  return (
    <aside ref={element} className="resource-folders" aria-label={t("library.folders")}>
      <header>
        <strong>{t("library.folders")}</strong>
        <ActionsMenu label={t("library.manageFolder")} items={actions(null)} />
      </header>
      <Button
        className={`resource-folder-root ${!folderId && !rootOnly ? "selected" : ""}`}
        onClick={() => onSelect(null, false)}
      >
        <Layers size={15} />
        {t("library.allResources")}
      </Button>
      <ContextActions items={actions(null)}>
        <div onDragOver={accepts} onDrop={(event) => drop(event, null)}>
          <Button
            className={`resource-folder-root ${rootOnly ? "selected" : ""}`}
            onClick={() => onSelect(null, true)}
          >
            <Inbox size={15} />
            {t("library.rootFolder")}
          </Button>
        </div>
      </ContextActions>
      <ResourceFolderTree
        folders={folders}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        renderRow={(folder, { depth, expanded, hasChildren, toggle }) => (
          <ContextActions items={actions(folder)}>
            <div
              data-folder-id={folder.id}
              className={`resource-folder-row ${folder.id === folderId ? "selected" : ""}`}
              style={{ paddingLeft: 8 + depth * 15 }}
              onDragOver={accepts}
              onDrop={(event) => drop(event, folder.id)}
              draggable
              onDragStart={(event) => {
                event.stopPropagation();
                event.dataTransfer.effectAllowed = "copyMove";
                event.dataTransfer.setData(
                  resourceDragType,
                  JSON.stringify({
                    resources: [],
                    folders: [{ id: folder.id, revision: folder.revision }],
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
              <ActionsMenu label={t("library.manageFolder")} items={actions(folder)} />
            </div>
          </ContextActions>
        )}
      />
    </aside>
  );
}
