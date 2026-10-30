import { t, deferMessage, useTranslation } from "@/shared/i18n";
import { useCallback, useLayoutEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { Resource, ResourceKind } from "@/bindings/workbench";
import { errorMessage } from "@/shared/host/error";
import { emptyComposition, emptyReferences, emptySettings } from "@/features/prompt/model";
import { libraryApi } from "./api";
import { hasPendingWork, waitForPendingWork } from "@/shared/host/pending-work";
import { resourceQuery } from "./resource-queries";
import { useLibrarySessionStore } from "./model/library-session-context";
import {
  acceptLibrarySave,
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
    useShallow(({ editor, dirty, busy, confirm, error }) => ({
      editor,
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

  const publish = (editor: Resource | null, dirty: boolean) => store.setState({ editor, dirty });

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

  const change = (resource: Resource) => editLibraryResource(store, resource);

  const refresh = async (id: string) => {
    try {
      await callbacks.current.onChanged(id);
    } finally {
      callbacks.current.refreshSearch();
    }
  };

  const create = (nextKind: ResourceKind) =>
    leave(() => {
      const current = store.getState();
      store.setState({
        operation: current.operation + 1,
        version: current.version + 1,
        editor: {
          id: crypto.randomUUID(),
          revision: 0,
          name: "",
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
        dirty: false,
        error: "",
      });
    });

  const select = (id: string) =>
    leave(() => {
      const operation = store.getState().operation + 1;
      store.setState({ operation, busy: true });
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
    const request = { id: snapshot.id, version: current.version };
    const operation = current.operation + 1;
    store.setState({ operation, busy: true, error: "" });
    try {
      const saved = await libraryApi.saveResource({ ...snapshot, name: snapshot.name.trim() });
      if (!isCurrent(operation)) return;
      client.setQueryData(["resource", saved.id], saved);
      acceptLibrarySave(store, request, saved);
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

  const remove = () => {
    const { editor, busy } = store.getState();
    if (!editor || busy) return;
    setConfirm({
      title: deferMessage(() => t("library.confirmDelete", { value0: editor.name })),
      action: () => {
        const current = store.getState();
        if (current.editor?.id !== editor.id || current.busy) return;
        const operation = current.operation + 1;
        store.setState({ operation, busy: true });
        void libraryApi
          .deleteResource(editor.id, editor.revision)
          .then(async () => {
            if (!isCurrent(operation)) return;
            client.setQueryData(["resource", editor.id], null);
            publish(null, false);
            await refresh(editor.id);
          })
          .catch((cause: unknown) => {
            if (isCurrent(operation)) setError(cause);
          })
          .finally(() => {
            if (isCurrent(operation)) setWorking(false);
          });
      },
    });
  };

  const dismiss = () => {
    const current = store.getState();
    store.setState({
      operation: current.operation + 1,
      version: current.version + 1,
      editor: null,
      dirty: false,
      busy: false,
    });
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
    remove,
    dismiss,
  };
}
