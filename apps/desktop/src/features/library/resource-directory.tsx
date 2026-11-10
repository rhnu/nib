import {
  ActionsMenu,
  Button,
  ContextActions,
  IconButton,
  type ActionMenuItem,
  Row,
  Grid,
  Input,
  Col,
} from "@/shared/ui";

import { ArrowLeft, ArrowRight, ArrowUp, ChevronRight, Folder, Check, X } from "lucide-react";
import { useEffect, useRef, type ReactNode, type DragEvent } from "react";
import type { ResourceFolder } from "@/bindings/workbench";
import { t, useTranslation } from "@/shared/i18n";

import { folderAncestry } from "./resource-location";

/** Shared location controls for the library, resource picker and destination browser. */
export function ResourceBreadcrumb({
  folderId,
  folders,
  onNavigate,
  history,
}: {
  folderId: string | null;
  folders: ResourceFolder[];
  onNavigate: (id: string | null) => void;
  history?: { canBack: boolean; canForward: boolean; back: () => void; forward: () => void };
}) {
  useTranslation();
  const path = folderAncestry(folderId, folders);
  return (
    <Row gap={0} className="resource-location flex items-center gap-space-2 flex-1 min-w-0">
      {history && (
        <>
          <IconButton
            label={t("library.backFolder")}
            disabled={!history.canBack}
            onClick={history.back}
          >
            <ArrowLeft size={15} />
          </IconButton>
          <IconButton
            label={t("library.forwardFolder")}
            disabled={!history.canForward}
            onClick={history.forward}
          >
            <ArrowRight size={15} />
          </IconButton>
        </>
      )}
      <IconButton
        label={t("library.upFolder")}
        disabled={!folderId}
        onClick={() => onNavigate(path.at(-1)?.parentId ?? null)}
      >
        <ArrowUp size={15} />
      </IconButton>
      <Row
        gap={0}
        as="nav"
        className="resource-breadcrumb [&_>_span]:shrink-0 [&_.ui-button]:shrink-0 [&_.ui-button]:max-w-[220px] [&_.ui-button]:py-0 [&_.ui-button]:px-space-2 [&_.ui-button]:overflow-hidden [&_.ui-button]:text-ellipsis [&_.ui-button]:whitespace-nowrap [&_[aria-current=location]]:font-semibold [&_svg]:shrink-0 [&_svg]:text-muted [&_>_span]:flex [&_>_span]:items-center flex items-center min-w-0 overflow-x-auto [scrollbar-width:thin]"
        aria-label={t("library.path")}
      >
        <Button
          variant="quiet"
          className=""
          aria-current={!folderId ? "location" : undefined}
          onClick={() => onNavigate(null)}
        >
          {t("library.rootFolder")}
        </Button>
        {path.map((folder) => (
          <span key={folder.id}>
            <ChevronRight size={12} aria-hidden />
            <Button
              variant="quiet"
              className=""
              title={folder.name}
              aria-current={folder.id === folderId ? "location" : undefined}
              onClick={() => onNavigate(folder.id)}
            >
              {folder.name}
            </Button>
          </span>
        ))}
      </Row>
    </Row>
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
    <Grid
      gap={0}
      align="stretch"
      className="resource-directory-items [&_>_*]:min-w-0 grid col-span-full grid-cols-[repeat(auto-fill,_minmax(165px,_1fr))] gap-space-3 mb-space-2"
      aria-label={t("library.folders")}
    >
      {folders.map((folder) => {
        const row = (
          <Row
            gap={0}
            className="resource-directory-item [&:hover]:border-line [&:hover]:bg-hover flex items-center min-w-0 min-h-[52px] p-space-1 border border-line-subtle rounded-control bg-panel"
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
              className="resource-directory-open [&_svg]:shrink-0 [&_svg]:text-accent [&_span]:overflow-hidden [&_span]:text-ellipsis [&_span]:whitespace-nowrap flex-1 min-w-0 justify-start gap-space-3 border-0 bg-transparent p-space-2"
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
          </Row>
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
    </Grid>
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
    <Row
      as="form"
      gap={2}
      className="resource-new-folder [&_>_input]:min-w-0 [&_>_input]:flex-1 [&_>_svg]:shrink-0 [&_>_svg]:text-accent flex items-center col-span-full gap-space-2 p-space-2 border border-accent rounded-control max-w-[440px]"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && name.trim()) onSave();
      }}
    >
      <Folder size={22} aria-hidden />
      <Input
        autoComplete="off"
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
    </Row>
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
    <Col
      gap={0}
      align="stretch"
      as="section"
      className="resource-destination [&_>_.resource-location]:p-space-2 [&_>_.resource-location]:border-b [&_>_.resource-location]:border-line-subtle [&_>_.resource-location]:flex-none flex flex-col min-h-[260px] border border-line-subtle rounded-control"
      aria-label={t("library.destinationFolder")}
    >
      <ResourceBreadcrumb folderId={folderId} folders={folders} onNavigate={onChange} />
      <Grid
        gap={0}
        align="stretch"
        columns={1}
        className="resource-destination-children [&_>_button]:justify-start [&_>_button_span]:flex-1 [&_>_button_span]:text-ellipsis [&_>_button_span]:whitespace-nowrap [&_>_button_span]:text-left [&_>_button_span]:overflow-hidden grid content-start gap-space-1 p-space-2 max-h-[310px] overflow-auto"
      >
        {children.length ? (
          children.map((folder) => (
            <Button key={folder.id} onClick={() => onChange(folder.id)}>
              <Folder size={16} />
              <span>{folder.name}</span>
              <ChevronRight size={14} />
            </Button>
          ))
        ) : (
          <p className="empty-note text-muted text-label leading-[1.75] m-[3px_0]">
            {t("library.noSubfolders")}
          </p>
        )}
      </Grid>
    </Col>
  );
}
