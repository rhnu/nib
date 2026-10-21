import { useLayoutEffect, useState } from "react";
import type { Resource, ResourceKind } from "../../bindings/workbench";
import { errorMessage } from "../../shared/host/error";
import { emptyComposition, emptyReferences, emptySettings } from "../prompt/model";
import { libraryApi } from "./api";
export function useResourceEditor(
  onChanged: () => Promise<void>,
  refreshSearch: () => void,
  onDirtyChange: (dirty: boolean) => void,
) {
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<Resource | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; action: () => void } | null>(null);
  useLayoutEffect(() => {
    onDirtyChange(dirty || busy);
  }, [dirty, busy, onDirtyChange]);
  const leave = (action: () => void) => {
    if (busy) return;
    if (dirty) setConfirm({ title: "放弃资源中未保存的修改？", action });
    else action();
  };
  const change = (resource: Resource) => {
    setEditor(resource);
    setDirty(true);
  };
  const refresh = async () => {
    await onChanged();
    refreshSearch();
  };
  const create = (nextKind: ResourceKind) =>
    leave(() => {
      setEditor({
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
      });
      setDirty(false);
      setError("");
    });
  const select = (id: string) =>
    leave(() => {
      setBusy(true);
      void libraryApi
        .resource(id)
        .then(
          (resource) => {
            setEditor(resource);
            setDirty(false);
            setError("");
          },
          (cause: unknown) => setError(errorMessage(cause)),
        )
        .finally(() => setBusy(false));
    });
  const save = async () => {
    if (!editor || busy) return;
    if (!editor.name.trim()) {
      setError("请填写资源名称。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await libraryApi.saveResource({ ...editor, name: editor.name.trim() });
      setEditor(saved);
      setDirty(false);
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const remove = () => {
    if (!editor) return;
    setConfirm({
      title: `删除“${editor.name}”？已有引用会保留并显示资源缺失。`,
      action: () => {
        setBusy(true);
        void libraryApi
          .deleteResource(editor.id, editor.revision)
          .then(async () => {
            setEditor(null);
            setDirty(false);
            await refresh();
          })
          .catch((cause: unknown) => setError(errorMessage(cause)))
          .finally(() => setBusy(false));
      },
    });
  };
  const dismiss = () => {
    setEditor(null);
    setDirty(false);
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
