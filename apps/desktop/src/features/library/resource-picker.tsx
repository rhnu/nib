import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Folder, Inbox, Layers, Search } from "lucide-react";
import type { ResourceKind, ResourceSummary } from "@/bindings/workbench";
import { settingValue } from "@/features/prompt/settings";
import { t, useTranslation } from "@/shared/i18n";
import { Button, Modal, Notice, Select } from "@/shared/ui";
import { errorMessage } from "@/shared/host/error";
import { libraryApi, resourceSearchQuery } from "./api";
import {
  ResourceCardContent,
  ResourceColumns,
  ResourcePagination,
  ResourceResults,
  ResourceViewSwitch,
  type ResourceView,
} from "./resource-browser";
import { ResourceFolderControls, ResourceFolderTree } from "./resource-folder-tree";
import { folderPath } from "./resource-metadata";
import { useResourceResults } from "./use-resource-results";
import "./styles.css";

/** Browse persisted resources in place; the caller owns the insertion and its success feedback. */
export function ResourcePicker({
  kind,
  model,
  contextLabel,
  onChoose,
  onClose,
}: {
  kind: ResourceKind;
  model?: string;
  contextLabel?: string;
  onChoose: (resource: ResourceSummary) => void;
  onClose: () => void;
}) {
  useTranslation();
  const [returnFocus] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const [text, setText] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [rootOnly, setRootOnly] = useState(false);
  const [includeSubfolders, setIncludeSubfolders] = useState(true);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [tag, setTag] = useState("");
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<ResourceView>("grid");
  const [selection, setSelection] = useState<{ id: string; query: string } | null>(null);
  const [scope, setScope] = useState({ kind, model });
  if (scope.kind !== kind || scope.model !== model) {
    setScope({ kind, model });
    setOffset(0);
    setSelection(null);
  }

  const query = resourceSearchQuery({
    text,
    kind,
    folderId,
    rootOnly,
    includeSubfolders,
    tags: tag ? [tag] : [],
    models: model ? [model] : [],
    offset,
    limit: 30,
  });
  const queryKey = JSON.stringify(query);
  const { items, total, pageSize, loading, queryError, retry } = useResourceResults(query);
  const folders = useQuery({ queryKey: ["resource-folders"], queryFn: libraryApi.folders });
  const tags = useQuery({ queryKey: ["resource-tags"], queryFn: libraryApi.tags });
  const catalogueError =
    queryError || (folders.error || tags.error ? errorMessage(folders.error ?? tags.error) : "");
  // A changed model or kind also invalidates selection before the new request has completed.
  const chosen =
    selection?.query === queryKey ? items.find((item) => item.id === selection.id) : undefined;
  const canChoose = !loading && !folders.isPending && !tags.isPending && !catalogueError;

  const reset = () => {
    setOffset(0);
    setSelection(null);
  };

  const navigate = (id: string | null, unfiled = false) => {
    setFolderId(id);
    setRootOnly(unfiled);
    reset();
  };

  const choose = (resource: ResourceSummary) => {
    if (canChoose) onChoose(resource);
  };

  const location = folderId
    ? folderPath(folderId, folders.data ?? [])
    : rootOnly
      ? t("library.rootFolder")
      : t("library.allResources");

  return (
    <Modal
      open
      className="resource-picker-modal"
      title={
        <>
          <span>{kind === "chunk" ? t("library.chooseChunk") : t("library.choosePreset")}</span>
          {contextLabel && <small className="resource-picker-context">{contextLabel}</small>}
        </>
      }
      onClose={onClose}
      finalFocus={() => (returnFocus?.isConnected ? returnFocus : true)}
    >
      <div className="resource-picker-body">
        <aside className="resource-folders" aria-label={t("library.folders")}>
          <header>
            <strong>{t("library.folders")}</strong>
          </header>
          <Button
            className={`resource-folder-root ${!folderId && !rootOnly ? "selected" : ""}`}
            aria-current={!folderId && !rootOnly ? "location" : undefined}
            onClick={() => navigate(null)}
          >
            <Layers size={15} />
            {t("library.allResources")}
          </Button>
          <Button
            className={`resource-folder-root ${rootOnly ? "selected" : ""}`}
            aria-current={rootOnly ? "location" : undefined}
            onClick={() => navigate(null, true)}
          >
            <Inbox size={15} />
            {t("library.rootFolder")}
          </Button>
          {folders.isPending ? (
            <output className="empty-note">{t("library.querying")}</output>
          ) : (
            <ResourceFolderTree
              folders={folders.data ?? []}
              collapsed={collapsed}
              onCollapsedChange={setCollapsed}
              renderRow={(folder, { depth, expanded, hasChildren, toggle }) => (
                <div
                  className={`resource-folder-row ${folder.id === folderId ? "selected" : ""}`}
                  style={{ paddingLeft: 8 + depth * 15 }}
                >
                  <ResourceFolderControls
                    folder={folder}
                    selected={folder.id === folderId}
                    expanded={expanded}
                    hasChildren={hasChildren}
                    toggle={toggle}
                    onSelect={() => navigate(folder.id)}
                  />
                </div>
              )}
            />
          )}
        </aside>
        <section className="resource-browser" aria-label={t("library.title")}>
          <div className="resource-picker-toolbar">
            <div className="library-search-field">
              <Search size={15} />
              <input
                aria-label={t("library.searchResources")}
                value={text}
                placeholder={t("library.searchPlaceholder")}
                onChange={(event) => {
                  setText(event.target.value);
                  reset();
                }}
              />
            </div>
            <Select
              aria-label={t("library.tags")}
              value={tag}
              onValueChange={(value) => {
                setTag(value);
                reset();
              }}
              options={[
                { value: "", label: t("library.allTags") },
                ...(tags.data ?? []).map((tag) => ({ value: tag, label: tag })),
              ]}
            />
            {model && (
              <span className="resource-picker-model" title={t("library.currentModel")}>
                {settingValue("model", model)}
              </span>
            )}
            <ResourceViewSwitch view={view} onChange={setView} />
          </div>
          <header className="resource-browser-heading">
            <Folder size={14} aria-hidden />
            <span className="resource-breadcrumb" title={location}>
              {location}
            </span>
            <span className="spacer" />
            {folderId && (
              <label className="resource-subfolder-toggle">
                <input
                  type="checkbox"
                  checked={includeSubfolders}
                  onChange={(event) => {
                    setIncludeSubfolders(event.target.checked);
                    reset();
                  }}
                />
                {t("library.includeSubfolders")}
              </label>
            )}
            <span className="muted">{t("library.resultCount", { count: total })}</span>
          </header>
          {catalogueError && (
            <Notice
              actions={
                <Button
                  onClick={() => {
                    void retry();
                    void folders.refetch();
                    void tags.refetch();
                  }}
                >
                  {t("library.retryQuery")}
                </Button>
              }
            >
              {catalogueError}
            </Notice>
          )}
          <ResourceResults
            loading={loading}
            queryError={!!catalogueError}
            empty={!items.length}
            filtered={Boolean(text || tag || folderId || rootOnly || model)}
            view={view}
          >
            {view === "list" && <ResourceColumns />}
            {items.map((item) => (
              <div
                key={item.id}
                className={`resource-row ${chosen?.id === item.id ? "selected" : ""}`}
              >
                <Button
                  className="resource-card-select"
                  aria-pressed={chosen?.id === item.id}
                  onClick={() => setSelection({ id: item.id, query: queryKey })}
                  onDoubleClick={() => choose(item)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      if (!event.repeat) choose(item);
                    }
                  }}
                >
                  <ResourceCardContent item={item} view={view} />
                  {chosen?.id === item.id && (
                    <span className="resource-picker-check" aria-hidden>
                      <Check size={13} />
                    </span>
                  )}
                </Button>
              </div>
            ))}
          </ResourceResults>
        </section>
      </div>
      <footer className="resource-picker-footer">
        <ResourcePagination
          offset={offset}
          total={total}
          pageSize={pageSize}
          loading={loading}
          onChange={(value) => {
            setOffset(value);
            setSelection(null);
          }}
        />
        <span className="resource-picker-selection" aria-live="polite">
          {chosen
            ? t("library.selectedResource", { name: chosen.name })
            : t("library.nothingSelected")}
        </span>
        <div className="dialog-actions">
          <Button onClick={onClose}>{t("library.cancel")}</Button>
          <Button
            className="primary"
            disabled={!chosen || !canChoose}
            onClick={() => {
              if (chosen) choose(chosen);
            }}
          >
            {kind === "chunk" ? t("library.insertChunk") : t("library.insertPreset")}
          </Button>
        </div>
      </footer>
    </Modal>
  );
}
