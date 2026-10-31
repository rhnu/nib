import { t, deferMessage, useTranslation } from "@/shared/i18n";
import { useCallback, useLayoutEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { Resource, ResourceKind } from "@/bindings/workbench";
import { errorMessage } from "@/shared/host/error";
import { emptyComposition, emptyReferences, emptySettings } from "@/features/prompt/model";
import { libraryApi } from "./api";
import { hasPendingWork, waitForPendingWork, trackPendingWork } from "@/shared/host/pending-work";
import { resourceQuery } from "./resource-queries";
import { useLibrarySessionStore } from "./model/library-session-context";
import {
  acceptLibrarySave,
  dismissLibraryResource,
  editLibraryResource,
  type LibrarySessionState,
} from "./model/library-session";

export function useResourceEditor(
  onChanged: (id: string) => Promise<void>,
  refreshSearch: () => void,
) {
  useTranslation();

  const client = useQueryClient();
  const store = useLibrarySessionStore();
  const state = useStore(
    store,
    useShallow(({ editor, saveMode, dirty, busy, confirm, error }) => ({
      editor,
      saveMode,
      dirty,
      busy,
      confirm,
      error,
    })),
  );
  // Only callbacks are component-owned; edits and operation identities live in the session.
  const callbacks = useRef({ onChanged, refreshSearch });
  useLayoutEffect(() => {
    callbacks.current = { onChanged, refreshSearch };
  }, [onChanged, refreshSearch]);

  const setError = useCallback((error: unknown) => store.setState({ error }), [store]);

  const setConfirm = useCallback(
    (confirm: LibrarySessionState["confirm"]) => store.setState({ confirm }),
    [store],
  );

  const isCurrent = (operation: number) => store.getState().operation === operation;

  const setWorking = (busy: boolean) => store.setState({ busy });

  const leave = (action: () => void) => {
    if (store.getState().busy) return;
    const operation = store.getState().operation;

    const proceed = () => {
      const current = store.getState();
      if (!isCurrent(operation) || current.busy) return;
      if (current.dirty)
        setConfirm({ title: deferMessage(() => t("library.discardChanges")), action });
      else action();
    };

    if (!hasPendingWork()) proceed();
    else
      void waitForPendingWork().then(proceed, (cause: unknown) => {
        if (isCurrent(operation))
          setError(
            deferMessage(() => t("library.actionIncomplete", { value0: errorMessage(cause) })),
          );
      });
  };

  const discardCovers = (resourceId: string, ids: string[]) => {
    if (!ids.length) return;
    void trackPendingWork(
      Promise.all(ids.map((id) => libraryApi.discardCover(resourceId, id))).catch(setError),
    );
  };

  const discardDraftCovers = () => {
    const current = store.getState();
    if (current.editor) discardCovers(current.editor.id, current.pendingCoverIds);
    store.setState({ pendingCoverIds: [] });
  };

  const change = (resource: Resource) => {
    const current = store.getState();
    if (!current.editor || current.editor.id !== resource.id) return;
    const previous = current.editor.coverAssetId;
    editLibraryResource(store, resource);
    if (
      previous &&
      previous !== resource.coverAssetId &&
      current.pendingCoverIds.includes(previous)
    ) {
      store.setState({ pendingCoverIds: current.pendingCoverIds.filter((id) => id !== previous) });
      discardCovers(resource.id, [previous]);
    }
  };

  const changeCover = (assetId: string, pending: boolean) => {
    const current = store.getState();
    if (!current.editor) return;
    if (pending) store.setState({ pendingCoverIds: [...current.pendingCoverIds, assetId] });
    change({ ...current.editor, coverAssetId: assetId });
  };

  const refresh = async (id: string) => {
    try {
      await callbacks.current.onChanged(id);
    } finally {
      callbacks.current.refreshSearch();
    }
  };

  const create = (nextKind: ResourceKind, folderId: string | null = null) =>
    leave(() => {
      discardDraftCovers();
      const current = store.getState();
      store.setState({
        operation: current.operation + 1,
        version: current.version + 1,
        editor: {
          id: crypto.randomUUID(),
          name: "",
          description: "",
          aliases: [],
          tags: [],
          models: [],
          folderId,
          coverAssetId: null,
          createdAt: 0,
          updatedAt: 0,
          content:
            nextKind === "chunk"
              ? { kind: "chunk", text: "" }
              : {
                  kind: "preset",
                  composition: emptyComposition(),
                  defaults: emptySettings(),
                  characters: [],
                  references: emptyReferences(),
                },
        },
        saveMode: "create",
        folderId,
        offset: 0,
        selectedIds: [],
        dirty: false,
        error: "",
      });
    });

  const select = (id: string) =>
    leave(() => {
      discardDraftCovers();
      const operation = store.getState().operation + 1;
      store.setState({ operation, busy: true, editor: null, dirty: false });
      void client
        .fetchQuery(resourceQuery(client, id))
        .then(
          (resource) => {
            if (!isCurrent(operation)) return;
            if (!resource) {
              setError(deferMessage(() => t("library.resourceMissing")));
              return;
            }
            store.setState({
              version: store.getState().version + 1,
              editor: resource,
              saveMode: "update",
              dirty: false,
              error: "",
            });
          },
          (cause: unknown) => {
            if (isCurrent(operation)) setError(cause);
          },
        )
        .finally(() => {
          if (isCurrent(operation)) setWorking(false);
        });
    });

  const save = async () => {
    if (store.getState().busy) return;
    const waitingOperation = store.getState().operation;
    try {
      await waitForPendingWork();
    } catch (cause) {
      if (isCurrent(waitingOperation))
        setError(
          deferMessage(() => t("library.actionIncomplete", { value0: errorMessage(cause) })),
        );
      return;
    }
    const current = store.getState();
    if (!isCurrent(waitingOperation) || current.busy || !current.editor) return;
    const snapshot = current.editor;
    if (!snapshot.name.trim()) {
      setError(deferMessage(() => t("library.nameRequired")));
      return;
    }
    const request = {
      id: snapshot.id,
      version: current.version,
      coverAssetId: snapshot.coverAssetId,
    };
    const operation = current.operation + 1;
    store.setState({ operation, busy: true, error: "" });
    try {
      const saved = await libraryApi.saveResource(
        { ...snapshot, name: snapshot.name.trim() },
        current.saveMode,
      );
      if (!isCurrent(operation)) return;
      client.setQueryData(["resource", saved.id], saved);
      acceptLibrarySave(store, request, saved);
      store.setState({
        pendingCoverIds: store.getState().pendingCoverIds.filter((id) => id !== saved.coverAssetId),
      });
      try {
        await refresh(saved.id);
      } catch (cause) {
        if (isCurrent(operation))
          setError(
            deferMessage(() => t("library.savedRefreshFailed", { value0: errorMessage(cause) })),
          );
      }
    } catch (cause) {
      if (isCurrent(operation)) setError(cause);
    } finally {
      if (isCurrent(operation)) setWorking(false);
    }
  };

  const dismiss = () => {
    discardDraftCovers();
    dismissLibraryResource(store);
  };

  return {
    ...state,
    error: state.error ? errorMessage(state.error) : "",
    setConfirm,
    setError,
    change,
    leave,
    create,
    select,
    save,
    changeCover,
    dismiss,
  };
}
