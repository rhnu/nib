import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Search } from "lucide-react";
import type { ResourceKind, ResourceSummary } from "@/bindings/workbench";
import { settingValue } from "@/features/prompt/settings";
import { t, useTranslation } from "@/shared/i18n";
import { Button, Modal, Notice } from "@/shared/ui";
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
import { ResourceFolders } from "./resource-folders";
import { ResourceBreadcrumb, ResourceDirectoryItems } from "./resource-directory";
import { folderAncestry, resourceLocationQuery } from "./resource-location";
import { folderPath } from "./resource-metadata";
import { useResourceResults } from "./use-resource-results";
import { ResourceTagSelect } from "./resource-filters";
import { createResourceBrowseState } from "./model/resource-browse-history";
import { useResourceBrowseHistory } from "./model/use-resource-browse-history";
import { useNavigationInput } from "@/shared/navigation/use-navigation-input";
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
  const browser = useRef<HTMLDivElement>(null);
  const folders = useQuery({ queryKey: ["resource-folders"], queryFn: libraryApi.folders });
  const history = useResourceBrowseHistory(
    createResourceBrowseState({ kind, model: model ?? "" }),
    folders.data,
    JSON.stringify([kind, model]),
  );
  const { query: text, folderId, tag, offset } = history.state;
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [view, setView] = useState<ResourceView>("grid");
  const [selection, setSelection] = useState<{ id: string; query: string } | null>(null);
  useNavigationInput({ element: browser, enabled: !!folders.data, onNavigate: history.move });

  const query = resourceSearchQuery({
    text,
    kind,
    ...resourceLocationQuery(folderId, text),
    tags: tag ? [tag] : [],
    models: model ? [model] : [],
    offset,
    limit: 30,
  });
  const queryKey = JSON.stringify(query);
  const { items, total, pageSize, loading, queryError, retry } = useResourceResults(query);
  const tags = useQuery({ queryKey: ["resource-tags"], queryFn: libraryApi.tags });
  const catalogueError =
    queryError || (folders.error || tags.error ? errorMessage(folders.error ?? tags.error) : "");
  // A changed model or kind also invalidates selection before the new request has completed.
  const chosen =
    selection?.query === queryKey ? items.find((item) => item.id === selection.id) : undefined;
  const canChoose = !loading && !folders.isPending && !tags.isPending && !catalogueError;

  const [selectionContext, setSelectionContext] = useState({
    queryKey,
    folderId,
    folders: folders.data,
  });
  if (selectionContext.queryKey !== queryKey || selectionContext.folders !== folders.data) {
    setSelectionContext({ queryKey, folderId, folders: folders.data });
    setSelection(null);
    if (selectionContext.folderId !== folderId || selectionContext.folders !== folders.data) {
      const path = folderAncestry(folderId, folders.data ?? []).map((folder) => folder.id);
      setCollapsed(collapsed.filter((id) => !path.includes(id)));
    }
  }

  const navigate = (id: string | null) => history.update({ folderId: id });

  const choose = (resource: ResourceSummary) => {
    if (canChoose) onChoose(resource);
  };

  const searching = Boolean(text.trim());
  const childFolders = searching
    ? []
    : (folders.data ?? []).filter((folder) => folder.parentId === folderId);

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
      <div className="resource-picker-body" ref={browser}>
        <ResourceFolders
          folders={folders.data ?? []}
          folderId={folderId}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          onSelect={navigate}
        />
        <section className="resource-browser" aria-label={t("library.title")}>
          <div className="resource-picker-toolbar">
            <div className="library-search-field">
              <Search size={15} />
              <input
                autoComplete="off"
                aria-label={t("library.searchResources")}
                value={text}
                placeholder={t("library.searchPlaceholder")}
                onChange={(event) => {
                  history.update({ query: event.target.value });
                }}
              />
            </div>
            <ResourceTagSelect
              value={tag}
              tags={tags.data ?? []}
              onChange={(tag) => history.update({ tag })}
            />
            {model && (
              <span className="resource-picker-model" title={t("library.currentModel")}>
                {settingValue("model", model)}
              </span>
            )}
            <ResourceViewSwitch view={view} onChange={setView} />
          </div>
          <header className="resource-browser-heading">
            <ResourceBreadcrumb
              folderId={folderId}
              folders={folders.data ?? []}
              onNavigate={navigate}
              history={{
                canBack: history.canBack,
                canForward: history.canForward,
                back: () => history.move("back"),
                forward: () => history.move("forward"),
              }}
            />
            <span className="spacer" />
          </header>
          {searching && <div className="resource-search-scope">{t("library.searchScope")}</div>}
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
            loading={loading || folders.isPending || tags.isPending}
            queryError={!!catalogueError}
            empty={!items.length && !childFolders.length}
            filtered={Boolean(text || tag || model)}
            view={view}
          >
            {view === "list" && <ResourceColumns />}
            <ResourceDirectoryItems folders={childFolders} onNavigate={navigate} />
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
                  {searching && (
                    <span
                      className="resource-result-path"
                      title={folderPath(item.folderId, folders.data ?? [])}
                    >
                      {folderPath(item.folderId, folders.data ?? [])}
                    </span>
                  )}
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
            history.update({ offset: value }, false);
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
