import { ArrowUp, ChevronRight, Folder, Check, X } from "lucide-react";
import { useEffect, useRef, type ReactNode, type DragEvent } from "react";
import type { ResourceFolder } from "@/bindings/workbench";
import { t, useTranslation } from "@/shared/i18n";
import { ActionsMenu, Button, ContextActions, IconButton, type ActionMenuItem } from "@/shared/ui";
import { folderAncestry } from "./resource-location";

/** Shared location controls for the library, resource picker and destination browser. */
export function ResourceBreadcrumb({
  folderId,
  folders,
  onNavigate,
}: {
  folderId: string | null;
  folders: ResourceFolder[];
  onNavigate: (id: string | null) => void;
}) {
  useTranslation();
  const path = folderAncestry(folderId, folders);
  return (
    <div className="resource-location">
      <IconButton
        label={t("library.upFolder")}
        disabled={!folderId}
        onClick={() => onNavigate(path.at(-1)?.parentId ?? null)}
      >
        <ArrowUp size={15} />
      </IconButton>
      <nav className="resource-breadcrumb" aria-label={t("library.path")}>
        <Button
          className="quiet"
          aria-current={!folderId ? "location" : undefined}
          onClick={() => onNavigate(null)}
        >
          {t("library.rootFolder")}
        </Button>
        {path.map((folder) => (
          <span key={folder.id}>
            <ChevronRight size={12} aria-hidden />
            <Button
              className="quiet"
              title={folder.name}
              aria-current={folder.id === folderId ? "location" : undefined}
              onClick={() => onNavigate(folder.id)}
            >
              {folder.name}
            </Button>
          </span>
        ))}
      </nav>
    </div>
  );
}

/** Direct child folders stay separate from resource selection and open by double-click or Enter. */
export function ResourceDirectoryItems({
  folders,
  onNavigate,
  actions,
  onDragStart,
  onDrop,
  onFocusFolder,
  children,
}: {
  folders: ResourceFolder[];
  onNavigate: (id: string) => void;
  actions?: (folder: ResourceFolder) => ActionMenuItem[];
  onDragStart?: (event: DragEvent, folder: ResourceFolder) => void;
  onDrop?: (event: DragEvent, folder: ResourceFolder) => void;
  onFocusFolder?: () => void;
  children?: ReactNode;
}) {
  useTranslation();
  if (!folders.length && !children) return null;
  return (
    <div className="resource-directory-items" aria-label={t("library.folders")}>
      {folders.map((folder) => {
        const row = (
          <div
            className="resource-directory-item"
            data-folder-id={folder.id}
            onFocus={onFocusFolder}
            draggable={!!onDragStart}
            onDragStart={(event) => onDragStart?.(event, folder)}
            onDragOver={(event) => {
              if (onDrop) event.preventDefault();
            }}
            onDrop={(event) => onDrop?.(event, folder)}
          >
            <Button
              className="resource-directory-open"
              title={folder.name}
              onDoubleClick={() => onNavigate(folder.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (!event.repeat) onNavigate(folder.id);
                }
              }}
            >
              <Folder size={23} aria-hidden />
              <span>{folder.name}</span>
            </Button>
            {actions && <ActionsMenu label={t("library.manageFolder")} items={actions(folder)} />}
          </div>
        );
        return actions ? (
          <ContextActions key={folder.id} items={actions(folder)}>
            {row}
          </ContextActions>
        ) : (
          <div key={folder.id}>{row}</div>
        );
      })}
      {children}
    </div>
  );
}

/** A new folder is named in the directory where it will be created. */
export function ResourceNewFolder({
  name,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  name: string;
  busy: boolean;
  onChange: (name: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  useTranslation();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <form
      className="resource-new-folder"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && name.trim()) onSave();
      }}
    >
      <Folder size={22} aria-hidden />
      <input
        ref={input}
        aria-label={t("library.folderName")}
        value={name}
        disabled={busy}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.stopPropagation();
            onCancel();
          }
        }}
      />
      <IconButton label={t("library.confirm")} type="submit" disabled={busy || !name.trim()}>
        <Check size={14} />
      </IconButton>
      <IconButton label={t("library.cancel")} disabled={busy} onClick={onCancel}>
        <X size={14} />
      </IconButton>
    </form>
  );
}

/** Choose a destination by navigating a tree's direct children, without a flattened dropdown. */
export function ResourceDestination({
  folderId,
  folders,
  onChange,
}: {
  folderId: string | null;
  folders: ResourceFolder[];
  onChange: (id: string | null) => void;
}) {
  useTranslation();
  const children = folders.filter((folder) => folder.parentId === folderId);
  return (
    <section className="resource-destination" aria-label={t("library.destinationFolder")}>
      <ResourceBreadcrumb folderId={folderId} folders={folders} onNavigate={onChange} />
      <div className="resource-destination-children">
        {children.length ? (
          children.map((folder) => (
            <Button key={folder.id} onClick={() => onChange(folder.id)}>
              <Folder size={16} />
              <span>{folder.name}</span>
              <ChevronRight size={14} />
            </Button>
          ))
        ) : (
          <p className="empty-note">{t("library.noSubfolders")}</p>
        )}
      </div>
    </section>
  );
}
