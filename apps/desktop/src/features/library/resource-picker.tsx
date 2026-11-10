import { Button, Modal, Notice, Grid, Col, Row, Input, ButtonGroup } from "@/shared/ui";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Search } from "lucide-react";
import type { ResourceKind, ResourceSummary } from "@/bindings/workbench";
import { settingValue } from "@/features/prompt/settings";
import { t, useTranslation } from "@/shared/i18n";

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
      className="resource-picker-modal [.modal&]:w-[min(1240px,_calc(100vw_-_64px))] [.modal&]:h-[min(840px,_calc(100dvh_-_var(--titlebar-height)_-_64px))] [.modal&]:max-h-[calc(100dvh_-_var(--titlebar-height)_-_64px)] [.modal&]:p-0 [.modal&]:flex [.modal&]:flex-col [.modal&]:overflow-hidden [&_>_.modal-header]:shrink-0 [&_>_.modal-header]:min-h-[54px] [&_>_.modal-header]:m-0 [&_>_.modal-header]:py-[10px] [&_>_.modal-header]:px-[18px] [&_>_.modal-header]:border-b [&_>_.modal-header]:border-line-subtle [&_.modal-header_h2]:flex [&_.modal-header_h2]:flex-col [&_.modal-header_h2]:items-start [&_.modal-header_h2]:gap-space-1 [&_.modal-header_h2]:min-w-0 [&_.modal-header_h2_>_span]:shrink-0 [&_.resource-browser-heading]:shrink-0 [&_.resource-browser-heading_>_svg]:shrink-0 [&_.resource-browser-heading_>_svg]:text-muted [&_.resource-grid_.resource-card-select]:h-full [&_.resource-detail-view_.resource-row]:block [&_.resource-detail-view_.resource-row]:p-0 [&_.resource-list-columns]:pr-[9px] max-[1100px]:[.modal&]:w-[calc(100vw_-_32px)] max-[1100px]:[.modal&]:h-[calc(100dvh_-_var(--titlebar-height)_-_32px)] max-[1100px]:[.modal&]:max-h-[calc(100dvh_-_var(--titlebar-height)_-_32px)] max-[760px]:[&_.resource-detail-view_.resource-card-select]:grid-cols-[34px_minmax(120px,_1fr)] max-[760px]:[&_.resource-detail-view_.resource-row-models]:hidden [&_.resource-browser-heading]:py-space-2 [&_.resource-browser-heading]:px-space-4 [&_.resource-browser-heading]:min-h-[44px] [&_.resource-list]:p-space-4 [&_.resource-grid]:grid-cols-[repeat(auto-fill,_minmax(175px,_1fr))] [&_.resource-list-columns]:grid-cols-[minmax(150px,_1.4fr)_minmax(80px,_1fr)_minmax(95px,_1fr)] [&_.resource-list-columns_>_:last-child]:hidden [&_.resource-detail-view_.resource-picker-check]:top-[3px] [&_.resource-detail-view_.resource-picker-check]:right-[3px] [&_.resource-detail-view_.resource-picker-check]:w-[16px] [&_.resource-detail-view_.resource-picker-check]:h-[16px] max-[760px]:[&_.resource-detail-view_.resource-row-tags]:hidden max-[760px]:[&_.resource-list-columns]:hidden"
      title={
        <>
          <span>{kind === "chunk" ? t("library.chooseChunk") : t("library.choosePreset")}</span>
          {contextLabel && (
            <small className="resource-picker-context text-label font-normal text-muted whitespace-nowrap overflow-hidden text-ellipsis">
              {contextLabel}
            </small>
          )}
        </>
      }
      onClose={onClose}
      finalFocus={() => (returnFocus?.isConnected ? returnFocus : true)}
    >
      <Grid
        gap={0}
        align="stretch"
        className="resource-picker-body [&_>_.resource-folders]:bg-panel [&_>_.resource-browser]:bg-background [&_>_.resource-folders]:py-space-4 [&_>_.resource-folders]:px-[7px] flex-1 min-h-0 grid grid-cols-[220px_minmax(0,_1fr)] max-[1100px]:grid-cols-[180px_minmax(0,_1fr)] max-[760px]:grid-cols-[155px_minmax(0,_1fr)]"
        ref={browser}
      >
        <ResourceFolders
          folders={folders.data ?? []}
          folderId={folderId}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          onSelect={navigate}
        />
        <Col
          gap={0}
          align="stretch"
          as="section"
          className="resource-browser flex flex-col min-w-0 min-h-0 outline-offset-[-2px] [container-type:inline-size] [container-name:resource-browser]"
          aria-label={t("library.title")}
        >
          <Row
            gap={0}
            className="resource-picker-toolbar [&_>_.select-trigger]:w-[145px] [&_>_.select-trigger]:min-w-[110px] [&_>_.button-group]:shrink-0 max-[760px]:[&_>_.library-search-field]:basis-full flex shrink-0 items-center gap-space-3 py-space-3 px-space-4 bg-panel border-b border-line-subtle max-[1100px]:flex-wrap"
          >
            <Row
              gap={0}
              className="library-search-field [&_>_svg]:left-[9px] [&_>_svg]:text-muted [&_>_input]:pl-[31px] [&_>_svg]:absolute relative flex items-center flex-1 min-w-[160px]"
            >
              <Search size={15} />
              <Input
                autoComplete="off"
                aria-label={t("library.searchResources")}
                value={text}
                placeholder={t("library.searchPlaceholder")}
                onChange={(event) => {
                  history.update({ query: event.target.value });
                }}
              />
            </Row>
            <ResourceTagSelect
              value={tag}
              tags={tags.data ?? []}
              onChange={(tag) => history.update({ tag })}
            />
            {model && (
              <span
                className="resource-picker-model max-w-[230px] py-space-2 px-[9px] border border-line-subtle rounded-control text-caption text-muted whitespace-nowrap overflow-hidden text-ellipsis max-[1100px]:max-w-[190px]"
                title={t("library.currentModel")}
              >
                {settingValue("model", model)}
              </span>
            )}
            <ResourceViewSwitch view={view} onChange={setView} />
          </Row>
          <Row
            gap={0}
            as="header"
            className="resource-browser-heading [&_>_.select-trigger]:w-[130px] [&_>_.select-trigger]:min-w-[100px] flex items-center gap-space-4 py-[7px] px-space-4 border-b border-line-subtle min-h-[44px]"
          >
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
            <span className="flex-1" />
          </Row>
          {searching && (
            <div className="resource-search-scope py-space-2 px-space-4 text-caption text-muted border-b border-line-subtle">
              {t("library.searchScope")}
            </div>
          )}
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
                className={`resource-row [&.selected]:border-accent [&.selected]:bg-accent-soft [&:hover]:border-line [&.selected:hover]:border-accent relative min-w-0 border border-line-subtle rounded-control outline-offset-[2px] cursor-default ${chosen?.id === item.id ? "selected" : ""}`}
              >
                <Button
                  className="resource-card-select [&:hover]:bg-transparent block border-0 bg-transparent text-left p-0 w-full text-foreground"
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
                      className="resource-result-path block overflow-hidden text-ellipsis whitespace-nowrap text-muted text-caption"
                      title={folderPath(item.folderId, folders.data ?? [])}
                    >
                      {folderPath(item.folderId, folders.data ?? [])}
                    </span>
                  )}
                  {chosen?.id === item.id && (
                    <Row
                      gap={0}
                      as="span"
                      className="resource-picker-check absolute top-[7px] right-[7px] flex items-center justify-center w-[21px] h-[21px] rounded-full bg-accent text-background"
                      aria-hidden
                    >
                      <Check size={13} />
                    </Row>
                  )}
                </Button>
              </div>
            ))}
          </ResourceResults>
        </Col>
      </Grid>
      <Row
        gap={0}
        as="footer"
        className="resource-picker-footer [&_.resource-pagination]:border-0 [&_.dialog-actions]:shrink-0 [&_.dialog-actions]:m-0 [&_.dialog-actions_>_[data-variant=primary]]:min-w-[100px] max-[760px]:[&_.dialog-actions]:ml-auto [&_.resource-pagination]:h-auto [&_.resource-pagination]:gap-space-3 [&_.resource-pagination]:shrink-0 [&_.resource-pagination]:p-0 flex shrink-0 items-center justify-between gap-space-5 min-h-[60px] py-[10px] px-[18px] border-t border-line-subtle bg-panel max-[760px]:flex-wrap max-[760px]:gap-space-3 max-[760px]:py-space-3 max-[760px]:px-space-4"
      >
        <ResourcePagination
          offset={offset}
          total={total}
          pageSize={pageSize}
          loading={loading}
          onChange={(value) => {
            history.update({ offset: value }, false);
          }}
        />
        <span
          className="resource-picker-selection min-w-0 text-muted text-label overflow-hidden text-ellipsis whitespace-nowrap max-[760px]:flex-1"
          aria-live="polite"
        >
          {chosen
            ? t("library.selectedResource", { name: chosen.name })
            : t("library.nothingSelected")}
        </span>
        <ButtonGroup className="dialog-actions flex items-center justify-end flex-wrap gap-space-3 mt-space-4">
          <Button onClick={onClose}>{t("library.cancel")}</Button>
          <Button
            variant="primary"
            className=""
            disabled={!chosen || !canChoose}
            onClick={() => {
              if (chosen) choose(chosen);
            }}
          >
            {kind === "chunk" ? t("library.insertChunk") : t("library.insertPreset")}
          </Button>
        </ButtonGroup>
      </Row>
    </Modal>
  );
}
