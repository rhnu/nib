import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Resource, ResourceKind } from "../../bindings/workbench";
import { errorMessage } from "../../shared/host/error";
import { emptyComposition, emptyReferences, emptySettings } from "../prompt/model";
import { libraryApi } from "./api";
import { mergeResourceSave } from "./resource-edit";
import { hasPendingWork, waitForPendingWork } from "../../shared/host/pending-work";
export function useResourceEditor(
  onChanged: (id: string) => Promise<void>,
  refreshSearch: () => void,
  onDirtyChange: (dirty: boolean) => void,
) {
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<Resource | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; action: () => void } | null>(null);
  const latest = useRef({
    active: true,
    editor: null as Resource | null,
    dirty: false,
    busy: false,
    version: 0,
    operation: 0,
    onChanged,
    refreshSearch,
    onDirtyChange,
  });
  useLayoutEffect(() => {
    Object.assign(latest.current, { onChanged, refreshSearch, onDirtyChange });
  }, [onChanged, refreshSearch, onDirtyChange]);
  useEffect(() => {
    const current = latest.current;
    current.active = true;
    return () => {
      current.active = false;
      current.operation++;
    };
  }, []);
  useLayoutEffect(() => {
    onDirtyChange(dirty || busy);
  }, [dirty, busy, onDirtyChange]);
  const leave = (action: () => void) => {
    if (latest.current.busy) return;
    const operation = latest.current.operation;
    const proceed = () => {
      if (!isCurrent(operation) || latest.current.busy) return;
      if (latest.current.dirty) setConfirm({ title: "放弃资源中未保存的修改？", action });
      else action();
    };
    if (!hasPendingWork()) proceed();
    else
      void waitForPendingWork().then(proceed, (cause: unknown) => {
        if (isCurrent(operation)) setError(`操作未完成，当前编辑已保留：${errorMessage(cause)}`);
      });
  };
  const publish = (next: Resource | null, nextDirty: boolean) => {
    latest.current.editor = next;
    latest.current.dirty = nextDirty;
    latest.current.onDirtyChange(nextDirty || latest.current.busy);
    setEditor(next);
    setDirty(nextDirty);
  };
  const setWorking = (working: boolean) => {
    latest.current.busy = working;
    latest.current.onDirtyChange(latest.current.dirty || working);
    setBusy(working);
  };
  const isCurrent = (operation: number) =>
    latest.current.active && latest.current.operation === operation;
  const change = (resource: Resource) => {
    const current = latest.current;
    if (!current.active || !current.editor || resource.id !== current.editor.id) return;
    current.version++;
    publish({ ...resource, revision: current.editor.revision }, true);
  };
  const refresh = async (id: string) => {
    try {
      await latest.current.onChanged(id);
    } finally {
      if (latest.current.active) latest.current.refreshSearch();
    }
  };
  const create = (nextKind: ResourceKind) =>
    leave(() => {
      latest.current.operation++;
      latest.current.version++;
      publish(
        {
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
        false,
      );
      setError("");
    });
  const select = (id: string) =>
    leave(() => {
      const operation = ++latest.current.operation;
      setWorking(true);
      void libraryApi
        .resource(id)
        .then(
          (resource) => {
            if (!isCurrent(operation)) return;
            latest.current.version++;
            publish(resource, false);
            setError("");
          },
          (cause: unknown) => {
            if (isCurrent(operation)) setError(errorMessage(cause));
          },
        )
        .finally(() => {
          if (isCurrent(operation)) setWorking(false);
        });
    });
  const save = async () => {
    const current = latest.current;
    if (current.busy || !current.active) return;
    const waitingOperation = current.operation;
    try {
      await waitForPendingWork();
    } catch (cause) {
      if (isCurrent(waitingOperation))
        setError(`操作未完成，当前编辑已保留：${errorMessage(cause)}`);
      return;
    }
    if (!isCurrent(waitingOperation) || current.busy) return;
    const snapshot = current.editor;
    if (!snapshot || current.busy || !current.active) return;
    if (!snapshot.name.trim()) {
      setError("请填写资源名称。");
      return;
    }
    const request = { id: snapshot.id, version: current.version };
    const operation = ++current.operation;
    setWorking(true);
    setError("");
    try {
      const saved = await libraryApi.saveResource({ ...snapshot, name: snapshot.name.trim() });
      if (!isCurrent(operation)) return;
      const merged = mergeResourceSave(current.editor, current.version, request, saved);
      if (merged) publish(merged.editor, merged.dirty);
      try {
        await refresh(saved.id);
      } catch (cause) {
        if (isCurrent(operation))
          setError(`资源已保存，但刷新资源列表失败：${errorMessage(cause)}`);
      }
    } catch (cause) {
      if (isCurrent(operation)) setError(errorMessage(cause));
    } finally {
      if (isCurrent(operation)) setWorking(false);
    }
  };
  const remove = () => {
    const editor = latest.current.editor;
    if (!editor || latest.current.busy) return;
    setConfirm({
      title: `删除“${editor.name}”？已有引用会保留并显示资源缺失。`,
      action: () => {
        if (latest.current.editor?.id !== editor.id || latest.current.busy) return;
        const operation = ++latest.current.operation;
        setWorking(true);
        void libraryApi
          .deleteResource(editor.id, editor.revision)
          .then(async () => {
            if (!isCurrent(operation)) return;
            publish(null, false);
            await refresh(editor.id);
          })
          .catch((cause: unknown) => {
            if (isCurrent(operation)) setError(errorMessage(cause));
          })
          .finally(() => {
            if (isCurrent(operation)) setWorking(false);
          });
      },
    });
  };
  const dismiss = () => {
    latest.current.operation++;
    latest.current.version++;
    publish(null, false);
    setWorking(false);
  };
  return {
    editor,
    dirty,
    busy,
    confirm,
    setConfirm,
    error,
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
