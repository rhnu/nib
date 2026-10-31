import { t, useTranslation } from "@/shared/i18n";
import { useEffect, useState, useRef, type MouseEvent, type DragEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { errorMessage } from "@/shared/host/error";
import { trackPendingWork } from "@/shared/host/pending-work";
import { resourceDependencies } from "./resource-dependencies";
import { Plus, Search, PanelRight, X } from "lucide-react";
import type {
  Resource,
  ResourceKind,
  ResourceSummary,
  ResourceFolder,
  ResourceSelection,
  ResourceBatchAction,
  ResourceImpact,
  ResourceSort,
} from "@/bindings/workbench";
import {
  ActionsMenu,
  Button,
  ContextActions,
  Field,
  IconButton,
  Modal,
  Notice,
  Select,
  type ActionMenuItem,
} from "@/shared/ui";
import { settingValue } from "@/features/prompt/settings";
import { ResourceEditor } from "./resource-editor";
import { ResourceList, resourceDragType } from "./resource-list";
import { ResourcePagination, ResourceViewSwitch } from "./resource-browser";
import { ResourceFolders } from "./resource-folders";
import { ResourceInspector } from "./resource-inspector";
import {
  ResourceBreadcrumb,
  ResourceDirectoryItems,
  ResourceDestination,
  ResourceNewFolder,
} from "./resource-directory";
import { destinationFolders, folderAncestry } from "./resource-location";
import { useResourceSearch } from "./use-resource-search";
import { useResourceEditor } from "./use-resource-editor";
import { useLibrarySessionStore } from "./model/library-session-context";
import { splitLabels } from "./resource-edit";
import { resourceFolderEdit } from "./resource-folder-edit";
import { completeLibraryPaste, runLibraryOperation } from "./model/library-session";
import { libraryApi } from "./api";

type OrganizeDialog =
  | {
      kind: "move" | "copy" | "tags" | "models";
      selection: ResourceSelection;
      folderId: string;
      tags: string;
      models: string[];
    }
  | { kind: "folder"; folder: ResourceFolder; original: ResourceFolder }
  | { kind: "rename"; resource: ResourceSummary; name: string }
  | { kind: "tag"; oldName: string; name: string };

export function ResourceLibrary({
  open,
  resources,
  models,
  onChanged,
  ensureResources,
  resourceVersion,
}: {
  open: boolean;
  resources: Map<string, Resource>;
  models: string[];
  onChanged: (id: string) => Promise<void>;
  ensureResources: (ids: string[]) => Promise<void>;
  resourceVersion: number;
}) {
  useTranslation();
  const client = useQueryClient();
  const store = useLibrarySessionStore();
  const { selectedIds, view, inspector, clipboard, collapsedFolders } = useStore(
    store,
    useShallow(({ selectedIds, view, inspector, clipboard, collapsedFolders }) => ({
      selectedIds,
      view,
      inspector,
      clipboard,
      collapsedFolders,
    })),
  );
  const search = useResourceSearch(open);
  const {
    query,
    kind,
    folderId,
    model,
    tag,
    offset,
    sort,
    descending,
    filter,
    items,
    total,
    pageSize,
    loading,
    queryError,
    refreshSearch,
  } = search;
  const editorState = useResourceEditor(onChanged, refreshSearch);
  const {
    editor,
    saveMode,
    dirty,
    busy,
    confirm,
    setConfirm,
    error,
    setError,
    change,
    changeCover,
    leave,
    create,
    select,
    save,
    dismiss,
  } = editorState;
  const folderQuery = useQuery({
    queryKey: ["resource-folders"],
    queryFn: libraryApi.folders,
    enabled: open,
  });
  const tagQuery = useQuery({
    queryKey: ["resource-tags"],
    queryFn: libraryApi.tags,
    enabled: open,
  });
  const folders = folderQuery.data ?? [];
  const tags = tagQuery.data ?? [];
  const [dialog, setDialog] = useState<OrganizeDialog | null>(null);
  const [creatingFolder, setCreatingFolder] = useState<{
    id: string;
    name: string;
    parentId: string | null;
  } | null>(null);
  const [deletion, setDeletion] = useState<{
    selection: ResourceSelection;
    impact: ResourceImpact;
  } | null>(null);
  const dependencyKey = JSON.stringify(editor ? resourceDependencies(editor) : []);
  useEffect(() => {
    void ensureResources(JSON.parse(dependencyKey) as string[]).catch(setError);
  }, [dependencyKey, ensureResources, setError, resourceVersion]);
  const browser = useRef<HTMLDivElement>(null);
  const selected = items.filter((item) => selectedIds.includes(item.id));

  const selectionFor = (item?: ResourceSummary): ResourceSelection => ({
    resources: (item && !selectedIds.includes(item.id) ? [item] : selected).map(({ id }) => id),
    folders: [],
  });

  const folderSelection = (folder: ResourceFolder): ResourceSelection => ({
    resources: [],
    folders: [folder.id],
  });

  const contextSelect = (id: string) => {
    if (!store.getState().selectedIds.includes(id)) store.setState({ selectedIds: [id] });
  };

  const refresh = async (ids: string[]) => {
    refreshSearch();
    await client.invalidateQueries({ queryKey: ["resource-folders"] });
    await Promise.all(ids.map(onChanged));
  };

  const run = (action: () => Promise<void>) =>
    runLibraryOperation(store, () => trackPendingWork(action()));

  const manage = (action: () => void) =>
    leave(() => {
      dismiss();
      action();
    });

  const batch = (
    selection: ResourceSelection,
    action: ResourceBatchAction,
    pastedCut?: ResourceSelection,
  ) => {
    const execute = () =>
      void run(async () => {
        const result = await libraryApi.batch(selection, action);
        if (action.kind === "delete") {
          if (result.resources.some((item) => item.id === store.getState().editor?.id)) dismiss();
          const currentFolder = store.getState().folderId;
          if (result.folders.some((folder) => folder.id === currentFolder))
            filter({ folderId: null });
          store.setState({ selectedIds: [] });
        }
        await refresh([
          ...new Set([...selection.resources, ...result.resources.map((item) => item.id)]),
        ]);
        if (action.kind === "copy")
          store.setState({ selectedIds: result.resources.map((item) => item.id) });
        if (action.kind === "move" && pastedCut) completeLibraryPaste(store, pastedCut);
        setDialog(null);
        setDeletion(null);
      });

    if (action.kind === "delete") execute();
    else manage(execute);
  };

  const requestDelete = (selection: ResourceSelection) =>
    void run(async () => {
      const impact = await libraryApi.impact(selection);
      setDeletion({ selection, impact });
    });

  const organize = (kind: "move" | "copy" | "tags" | "models", selection: ResourceSelection) =>
    manage(() =>
      setDialog({
        kind,
        selection,
        folderId: destinationFolders(folders, selection.folders).some(
          (folder) => folder.id === folderId,
        )
          ? (folderId ?? "")
          : "",
        tags: "",
        models: [],
      }),
    );

  const paste = (destination: string | null) => {
    const value = store.getState().clipboard;
    if (value)
      batch(
        value.selection,
        { kind: value.cut ? "move" : "copy", folderId: destination },
        value.cut ? value.selection : undefined,
      );
  };

  const createIn = (nextKind: ResourceKind, destination: string | null) => {
    setCreatingFolder(null);
    create(nextKind, destination);
  };

  const navigate = (id: string | null) =>
    manage(() => {
      setCreatingFolder(null);
      const path = folderAncestry(id, folders).map((folder) => folder.id);
      store.setState({
        collapsedFolders: store.getState().collapsedFolders.filter((id) => !path.includes(id)),
      });
      filter({ folderId: id });
    });

  const newFolder = (parentId: string | null) =>
    manage(() => {
      filter({ folderId: parentId, query: "" });
      setCreatingFolder({ id: crypto.randomUUID(), name: "", parentId });
    });

  const saveNewFolder = () => {
    if (!creatingFolder) return;
    const snapshot = creatingFolder;
    void run(async () => {
      await libraryApi.saveFolder({ kind: "create", ...snapshot, name: snapshot.name.trim() });
      await client.invalidateQueries({ queryKey: ["resource-folders"] });
      setCreatingFolder(null);
    });
  };

  const dropInto = (event: DragEvent, folder: ResourceFolder) => {
    if (!event.dataTransfer.types.includes(resourceDragType)) return;
    event.preventDefault();
    event.stopPropagation();
    let selection: ResourceSelection;
    try {
      selection = JSON.parse(event.dataTransfer.getData(resourceDragType)) as ResourceSelection;
    } catch {
      return;
    }
    batch(selection, { kind: event.ctrlKey ? "copy" : "move", folderId: folder.id });
  };

  const resourceActions = (item?: ResourceSummary): ActionMenuItem[] => {
    const selection = selectionFor(item);
    const one = item ?? selected[0];
    return [
      ...(one && selection.resources.length === 1
        ? [
            { label: t("library.edit"), action: () => select(one.id), disabled: busy },
            {
              label: t("library.rename"),
              shortcut: "F2",
              action: () => setDialog({ kind: "rename", resource: one, name: one.name }),
              disabled: busy,
            },
          ]
        : []),
      {
        label: t("library.move"),
        action: () => organize("move", selection),
        disabled: busy || !selection.resources.length,
      },
      {
        label: t("library.duplicate"),
        action: () => organize("copy", selection),
        disabled: busy || !selection.resources.length,
      },
      {
        label: t("library.editTags"),
        action: () => organize("tags", selection),
        disabled: busy || !selection.resources.length,
      },
      {
        label: t("library.editModels"),
        action: () => organize("models", selection),
        disabled: busy || !selection.resources.length,
      },
      { separator: true },
      {
        label: t("library.copy"),
        shortcut: "Ctrl+C",
        action: () => store.setState({ clipboard: { selection, cut: false } }),
        disabled: busy || !selection.resources.length,
      },
      {
        label: t("library.cut"),
        shortcut: "Ctrl+X",
        action: () => store.setState({ clipboard: { selection, cut: true } }),
        disabled: busy || !selection.resources.length,
      },
      { separator: true },
      {
        label: t("library.deleteResource"),
        danger: true,
        action: () => requestDelete(selection),
        disabled: busy || !selection.resources.length,
      },
    ];
  };

  const folderActions = (folder: ResourceFolder | null): ActionMenuItem[] => [
    {
      label: t("library.createFolder"),
      action: () => newFolder(folder?.id ?? null),
      disabled: busy,
    },
    {
      label: t("library.createChunk"),
      action: () => createIn("chunk", folder?.id ?? null),
      disabled: busy,
    },
    {
      label: t("library.createPreset"),
      action: () => createIn("preset", folder?.id ?? null),
      disabled: busy,
    },
    {
      label: t("library.paste"),
      shortcut: "Ctrl+V",
      action: () => paste(folder?.id ?? null),
      disabled: busy || !clipboard,
    },
    ...(folder
      ? [
          { separator: true } as ActionMenuItem,
          {
            label: t("library.renameFolder"),
            action: () => setDialog({ kind: "folder", folder, original: folder }),
            disabled: busy,
          },
          {
            label: t("library.move"),
            action: () => organize("move", folderSelection(folder)),
            disabled: busy,
          },
          {
            label: t("library.copy"),
            action: () =>
              store.setState({ clipboard: { selection: folderSelection(folder), cut: false } }),
            disabled: busy,
          },
          {
            label: t("library.cut"),
            action: () =>
              store.setState({ clipboard: { selection: folderSelection(folder), cut: true } }),
            disabled: busy,
          },
          { separator: true } as ActionMenuItem,
          {
            label: t("library.deleteFolder"),
            danger: true,
            action: () => requestDelete(folderSelection(folder)),
            disabled: busy,
          },
        ]
      : []),
  ];

  const currentFolder = folders.find((folder) => folder.id === folderId) ?? null;
  const searching = Boolean(query.trim());
  const childFolders = searching ? [] : folders.filter((folder) => folder.parentId === folderId);
  const availableDestinations =
    dialog && (dialog.kind === "move" || dialog.kind === "copy")
      ? destinationFolders(folders, dialog.selection.folders)
      : folders;
  const blankActions: ActionMenuItem[] = [
    ...folderActions(currentFolder),
    { separator: true },
    {
      label: t("library.selectAll"),
      action: () => store.setState({ selectedIds: items.map((item) => item.id) }),
      disabled: !items.length,
    },
    {
      label: t("library.refresh"),
      action: () => {
        refreshSearch();
        void folderQuery.refetch();
      },
      disabled: loading,
    },
  ];

  const clickSelect = (id: string, event: MouseEvent) => {
    if (event.shiftKey && selectedIds.length) {
      const start = items.findIndex((item) => item.id === selectedIds[0]);
      const end = items.findIndex((item) => item.id === id);
      store.setState({
        selectedIds: items
          .slice(Math.max(0, Math.min(start, end)), Math.max(start, end) + 1)
          .map((item) => item.id),
      });
    } else if (event.ctrlKey || event.metaKey)
      store.setState({
        selectedIds: selectedIds.includes(id)
          ? selectedIds.filter((item) => item !== id)
          : [...selectedIds, id],
      });
    else store.setState({ selectedIds: [id] });
  };

  // Keyboard commands are scoped to the browser; native text fields retain their own shortcuts.
  useEffect(() => {
    const element = browser.current;
    if (!element) return;

    const keydown = (event: KeyboardEvent) => {
      if (store.getState().busy) return;
      if ((event.target as Element).closest("input,textarea,[contenteditable=true]")) return;
      const folderElement = (event.target as Element).closest<HTMLElement>("[data-folder-id]");
      const activeFolder = folders.find((folder) => folder.id === folderElement?.dataset.folderId);
      const activeSelection = activeFolder ? folderSelection(activeFolder) : selectionFor();
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === "a") {
          event.preventDefault();
          store.setState({ selectedIds: items.map((item) => item.id) });
        } else if (key === "c" || key === "x") {
          event.preventDefault();
          if (activeFolder || selected.length)
            store.setState({ clipboard: { selection: activeSelection, cut: key === "x" } });
        } else if (key === "v") {
          event.preventDefault();
          paste(activeFolder?.id ?? folderId);
        }
      } else if (event.key === "F2" && (activeFolder || selected.length === 1)) {
        event.preventDefault();
        if (activeFolder)
          setDialog({ kind: "folder", folder: activeFolder, original: activeFolder });
        else setDialog({ kind: "rename", resource: selected[0], name: selected[0].name });
      } else if (event.key === "Delete" && (activeFolder || selected.length)) {
        event.preventDefault();
        requestDelete(activeSelection);
      }
    };

    const click = (event: Event) => {
      if (
        event.target === element ||
        (event.target instanceof Element && event.target.classList.contains("resource-list"))
      )
        store.setState({ selectedIds: [] });
    };

    element.addEventListener("keydown", keydown);
    element.addEventListener("click", click);
    return () => {
      element.removeEventListener("keydown", keydown);
      element.removeEventListener("click", click);
    };
  });
  return (
    <>
      <section className="library-page" hidden={!open} aria-label={t("library.title")}>
        <div className="library-toolbar">
          <div className="library-search-field">
            <Search size={15} />
            <input
              aria-label={t("library.searchResources")}
              placeholder={t("library.searchPlaceholder")}
              value={query}
              onChange={(event) => {
                setCreatingFolder(null);
                filter({ query: event.target.value });
              }}
            />
          </div>
          <Select
            aria-label={t("library.resourceType")}
            value={kind}
            onValueChange={(kind) => filter({ kind: kind as ResourceKind | "" })}
            options={[
              { value: "", label: t("library.allTypes") },
              { value: "chunk", label: t("library.chunk") },
              { value: "preset", label: t("library.preset") },
            ]}
          />
          <Select
            aria-label={t("library.models")}
            value={model}
            onValueChange={(model) => filter({ model })}
            options={[
              { value: "", label: t("library.allModels") },
              ...models.map((model) => ({ value: model, label: settingValue("model", model) })),
            ]}
          />
          <Select
            aria-label={t("library.tags")}
            value={tag}
            onValueChange={(tag) => filter({ tag })}
            options={[
              { value: "", label: t("library.allTags") },
              ...tags.map((tag) => ({ value: tag, label: tag })),
            ]}
          />
          <ActionsMenu
            label={t("library.manageTag")}
            items={[
              {
                label: t("library.renameTag"),
                disabled: busy || !tag,
                action: () => manage(() => setDialog({ kind: "tag", oldName: tag, name: tag })),
              },
              {
                label: t("library.deleteTag"),
                danger: true,
                disabled: busy || !tag,
                action: () =>
                  setConfirm({
                    title: t("library.confirmDeleteTag"),
                    action: () =>
                      manage(
                        () =>
                          void run(async () => {
                            const changed = await libraryApi.deleteTag(tag);
                            filter({ tag: "" });
                            await refresh(changed.map((item) => item.id));
                          }),
                      ),
                  }),
              },
            ]}
          />
          <ActionsMenu
            label={t("library.createResource")}
            items={[
              {
                label: t("library.createChunk"),
                action: () => createIn("chunk", folderId),
                disabled: busy,
              },
              {
                label: t("library.createPreset"),
                action: () => createIn("preset", folderId),
                disabled: busy,
              },
              {
                label: t("library.createFolder"),
                action: () => newFolder(folderId),
                disabled: busy,
              },
            ]}
          >
            <Plus size={14} />
            {t("library.create")}
          </ActionsMenu>
          <div className="button-group">
            <ResourceViewSwitch view={view} onChange={(view) => store.setState({ view })} />
            <IconButton
              label={t("library.inspector")}
              aria-pressed={inspector}
              onClick={() => store.setState({ inspector: !inspector })}
            >
              <PanelRight size={15} />
            </IconButton>
          </div>
        </div>
        {(error || queryError || folderQuery.error || tagQuery.error) && (
          <Notice
            actions={
              <Button
                onClick={() => {
                  setError("");
                  refreshSearch();
                  void folderQuery.refetch();
                  void tagQuery.refetch();
                }}
              >
                {t("library.retryQuery")}
              </Button>
            }
          >
            {error || queryError || errorMessage(folderQuery.error ?? tagQuery.error)}
          </Notice>
        )}
        <div
          className={`library-body ${editor ? "is-editing" : ""} ${inspector ? "has-inspector" : ""}`}
        >
          <ResourceFolders
            folders={folders}
            folderId={folderId}
            collapsed={collapsedFolders}
            onCollapsedChange={(collapsedFolders) => store.setState({ collapsedFolders })}
            onSelect={navigate}
            actions={folderActions}
            onRename={(folder) => {
              if (!busy) setDialog({ kind: "folder", folder, original: folder });
            }}
            onDropSelection={(selection, folderId, copy) =>
              batch(selection, { kind: copy ? "copy" : "move", folderId })
            }
          />
          {editor ? (
            <ResourceEditor
              key={editor.id}
              editor={editor}
              persisted={saveMode === "update"}
              dirty={dirty}
              busy={busy}
              models={models}
              resources={resources}
              folders={folders}
              tags={tags}
              change={change}
              changeCover={changeCover}
              leave={leave}
              dismiss={dismiss}
              remove={() =>
                requestDelete({
                  resources: [editor.id],
                  folders: [],
                })
              }
              save={save}
              setError={setError}
            />
          ) : (
            <>
              <ContextActions items={blankActions}>
                <div className="resource-browser" ref={browser}>
                  <header className="resource-browser-heading">
                    <ResourceBreadcrumb
                      folderId={folderId}
                      folders={folders}
                      onNavigate={navigate}
                    />
                    <span className="spacer" />
                    <Select
                      aria-label={t("library.sort")}
                      value={sort}
                      onValueChange={(value) => filter({ sort: value as ResourceSort })}
                      options={[
                        { value: "name", label: t("library.resourceName") },
                        { value: "updatedAt", label: t("library.updated") },
                        { value: "createdAt", label: t("library.created") },
                      ]}
                    />
                    <IconButton
                      label={descending ? t("library.descending") : t("library.ascending")}
                      onClick={() => filter({ descending: !descending })}
                    >
                      {descending ? "↓" : "↑"}
                    </IconButton>
                    <span className="muted">{t("library.resultCount", { count: total })}</span>
                    <ActionsMenu label={t("library.folderActions")} items={blankActions} />
                  </header>
                  {searching && (
                    <div className="resource-search-scope">{t("library.searchScope")}</div>
                  )}
                  {selected.length > 0 && (
                    <div className="resource-selection-toolbar">
                      <strong>{t("library.selectedCount", { count: selected.length })}</strong>
                      <Button disabled={busy} onClick={() => organize("move", selectionFor())}>
                        {t("library.move")}
                      </Button>
                      <Button disabled={busy} onClick={() => organize("tags", selectionFor())}>
                        {t("library.editTags")}
                      </Button>
                      <ActionsMenu label={t("library.manageResource")} items={resourceActions()} />
                      <IconButton
                        label={t("library.clearSelection")}
                        onClick={() => store.setState({ selectedIds: [] })}
                      >
                        <X size={14} />
                      </IconButton>
                    </div>
                  )}
                  <ResourceList
                    loading={loading || folderQuery.isPending}
                    queryError={
                      queryError || (folderQuery.error ? errorMessage(folderQuery.error) : "")
                    }
                    items={items}
                    filtered={Boolean(query || kind || model || tag)}
                    selectedIds={selectedIds}
                    view={view}
                    onSelect={clickSelect}
                    onActivate={select}
                    actions={resourceActions}
                    onContextSelect={contextSelect}
                    hasDirectories={childFolders.length > 0 || !!creatingFolder}
                    searchFolders={searching ? folders : undefined}
                    directoryItems={
                      <ResourceDirectoryItems
                        folders={childFolders}
                        onNavigate={navigate}
                        actions={folderActions}
                        onFocusFolder={() => store.setState({ selectedIds: [] })}
                        onDrop={dropInto}
                        onDragStart={(event, folder) => {
                          event.stopPropagation();
                          event.dataTransfer.effectAllowed = "copyMove";
                          event.dataTransfer.setData(
                            resourceDragType,
                            JSON.stringify(folderSelection(folder)),
                          );
                        }}
                      >
                        {creatingFolder && (
                          <ResourceNewFolder
                            name={creatingFolder.name}
                            busy={busy}
                            onChange={(name) => setCreatingFolder({ ...creatingFolder, name })}
                            onSave={saveNewFolder}
                            onCancel={() => setCreatingFolder(null)}
                          />
                        )}
                      </ResourceDirectoryItems>
                    }
                  />
                  <ResourcePagination
                    offset={offset}
                    total={total}
                    pageSize={pageSize}
                    loading={loading}
                    onChange={(offset) => store.setState({ offset, selectedIds: [] })}
                  />
                </div>
              </ContextActions>
              {inspector && (
                <ResourceInspector
                  item={selected[0]}
                  count={selected.length}
                  folders={folders}
                  onClose={() => store.setState({ inspector: false })}
                  onEdit={select}
                />
              )}
            </>
          )}
        </div>
      </section>
      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={t("library.confirmAction")}
      >
        <p className="confirm-copy">{confirm && errorMessage(confirm.title)}</p>
        <div className="dialog-actions">
          <Button onClick={() => setConfirm(null)}>{t("library.cancel")}</Button>
          <Button
            className="danger-button"
            onClick={() => {
              const action = confirm?.action;
              setConfirm(null);
              action?.();
            }}
          >
            {t("library.confirm")}
          </Button>
        </div>
      </Modal>
      <Modal
        open={dialog !== null}
        onClose={() => {
          if (!busy) setDialog(null);
        }}
        title={
          dialog?.kind === "folder"
            ? t("library.renameFolder")
            : dialog?.kind === "tags"
              ? t("library.editTags")
              : dialog?.kind === "models"
                ? t("library.editModels")
                : dialog?.kind === "rename"
                  ? t("library.rename")
                  : dialog?.kind === "tag"
                    ? t("library.renameTag")
                    : dialog?.kind === "copy"
                      ? t("library.duplicate")
                      : t("library.move")
        }
      >
        {error && (
          <p className="inline-warning" role="alert">
            {error}
          </p>
        )}
        {dialog && (
          <fieldset disabled={busy} className="resource-organize-form">
            {dialog.kind === "rename" || dialog.kind === "tag" ? (
              <Field
                label={dialog.kind === "tag" ? t("library.tagName") : t("library.resourceName")}
              >
                <input
                  value={dialog.name}
                  onChange={(event) => setDialog({ ...dialog, name: event.target.value })}
                />
              </Field>
            ) : dialog.kind === "models" ? (
              <fieldset className="resource-models">
                <legend>{t("library.models")}</legend>
                <small className="muted">{t("library.modelsHint")}</small>
                <div>
                  {models.map((model) => (
                    <label key={model}>
                      <input
                        type="checkbox"
                        checked={dialog.models.includes(model)}
                        onChange={(event) =>
                          setDialog({
                            ...dialog,
                            models: event.target.checked
                              ? [...dialog.models, model]
                              : dialog.models.filter((item) => item !== model),
                          })
                        }
                      />
                      {settingValue("model", model)}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : dialog.kind === "folder" ? (
              <>
                <Field label={t("library.folderName")}>
                  <input
                    value={dialog.folder.name}
                    onChange={(event) =>
                      setDialog({
                        ...dialog,
                        folder: { ...dialog.folder, name: event.target.value },
                      })
                    }
                  />
                </Field>
              </>
            ) : dialog.kind === "tags" ? (
              <Field label={t("library.replaceTags")}>
                <input
                  value={dialog.tags}
                  onChange={(event) => setDialog({ ...dialog, tags: event.target.value })}
                  list="library-batch-tags"
                />
                <datalist id="library-batch-tags">
                  {tags.map((tag) => (
                    <option value={tag} key={tag}>
                      {tag}
                    </option>
                  ))}
                </datalist>
              </Field>
            ) : (
              <ResourceDestination
                folderId={dialog.folderId || null}
                folders={availableDestinations}
                onChange={(id) => setDialog({ ...dialog, folderId: id ?? "" })}
              />
            )}
            <div className="dialog-actions">
              <Button onClick={() => setDialog(null)}>{t("library.cancel")}</Button>
              <Button
                className="primary"
                disabled={
                  (dialog.kind === "folder" && !dialog.folder.name.trim()) ||
                  ((dialog.kind === "rename" || dialog.kind === "tag") && !dialog.name.trim())
                }
                onClick={() => {
                  if (dialog.kind === "folder")
                    void run(async () => {
                      await libraryApi.saveFolder(
                        resourceFolderEdit(dialog.original, dialog.folder),
                      );
                      await client.invalidateQueries({ queryKey: ["resource-folders"] });
                      setDialog(null);
                    });
                  else if (dialog.kind === "rename")
                    void run(async () => {
                      const resource = await libraryApi.resource(dialog.resource.id);
                      await libraryApi.saveResource(
                        { ...resource, name: dialog.name.trim() },
                        "update",
                      );
                      await refresh([resource.id]);
                      setDialog(null);
                    });
                  else if (dialog.kind === "tag")
                    void run(async () => {
                      const changed = await libraryApi.renameTag(
                        dialog.oldName,
                        dialog.name.trim(),
                      );
                      filter({ tag: dialog.name.trim() });
                      await refresh(changed.map((item) => item.id));
                      setDialog(null);
                    });
                  else
                    batch(
                      dialog.selection,
                      dialog.kind === "tags"
                        ? { kind: "metadata", tags: splitLabels(dialog.tags), models: null }
                        : dialog.kind === "models"
                          ? { kind: "metadata", tags: null, models: dialog.models }
                          : { kind: dialog.kind, folderId: dialog.folderId || null },
                    );
                }}
              >
                {busy ? t("library.saving") : t("library.confirm")}
              </Button>
            </div>
          </fieldset>
        )}
      </Modal>
      <Modal
        open={deletion !== null}
        onClose={() => {
          if (!busy) setDeletion(null);
        }}
        title={t("library.confirmDeleteTitle")}
      >
        {error && (
          <p className="inline-warning" role="alert">
            {error}
          </p>
        )}
        {deletion && (
          <>
            <p>
              {t("library.deleteImpact", {
                resources: deletion.impact.resources.length,
                folders: deletion.impact.folders.length,
              })}
            </p>
            <p className="inline-warning">{t("library.deleteReferencesWarning")}</p>
            {deletion.impact.currentCreation && <p>{t("library.currentCreationAffected")}</p>}
            {deletion.impact.referencingResources.length > 0 && (
              <>
                <p>{t("library.referencingResources")}</p>
                <ul className="resource-impact-list">
                  {deletion.impact.referencingResources.map((resource) => (
                    <li key={resource.id}>{resource.name}</li>
                  ))}
                </ul>
              </>
            )}
            {deletion.impact.currentCreation === false &&
              deletion.impact.referencingResources.length === 0 && (
                <p className="muted">{t("library.noReferences")}</p>
              )}
            {dirty && <p className="inline-warning">{t("library.unsaved")}</p>}
            <div className="dialog-actions">
              <Button disabled={busy} onClick={() => setDeletion(null)}>
                {t("library.cancel")}
              </Button>
              <Button
                className="danger-button"
                disabled={busy}
                onClick={() => batch(deletion.selection, { kind: "delete" })}
              >
                {t("library.deleteResource")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
