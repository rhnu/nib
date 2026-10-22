import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { MediaAsset } from "../../bindings/media";
import { errorMessage } from "../../shared/host/error";
import { Button, Notice } from "../../shared/ui";
import { mediaApi } from "./api";
import { imageUnavailableReason, singleImageFile } from "./model";
import "./media.css";

export function ImageImporter({ onImported }: { onImported: (asset: MediaAsset) => void }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const latest = useRef({ active: true, locked: false, onImported });
  useLayoutEffect(() => {
    latest.current.onImported = onImported;
  }, [onImported]);
  useEffect(() => {
    const current = latest.current;
    current.active = true;
    return () => {
      current.active = false;
    };
  }, []);

  const importFile = async (file: File) => {
    if (latest.current.locked) return;
    latest.current.locked = true;
    setBusy(true);
    setError(null);
    setLastFile(file);
    try {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      if (!latest.current.active) return;
      const asset = await mediaApi.importImage(bytes, file.name);
      if (!latest.current.active) return;
      const reason = imageUnavailableReason(asset);
      if (reason) throw new Error(reason);
      setLastFile(null);
      latest.current.onImported(asset);
    } catch (cause) {
      if (latest.current.active) setError(errorMessage(cause));
    } finally {
      latest.current.locked = false;
      if (latest.current.active) setBusy(false);
    }
  };
  const choose = (files: ArrayLike<File>) => {
    if (latest.current.locked) return;
    const selection = singleImageFile(files);
    if (selection.error) {
      setLastFile(null);
      setError(selection.error);
    } else if (selection.file) void importFile(selection.file);
  };
  return (
    <section className="image-importer" aria-label="导入图片" aria-busy={busy}>
      <div
        className={`image-drop-target ${dragging ? "is-dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = busy ? "none" : "copy";
          if (!busy) setDragging(true);
        }}
        onDragLeave={(event) => {
          if (
            !(event.relatedTarget instanceof Node) ||
            !event.currentTarget.contains(event.relatedTarget)
          )
            setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragging(false);
          if (event.dataTransfer.files.length === 0) setError("请拖入单张本地图片文件。");
          else choose(event.dataTransfer.files);
        }}
      >
        <label htmlFor={id}>
          {busy ? "正在保存图片…" : "选择图片，或拖入单张 PNG / JPEG / WebP"}
        </label>
        <input
          id={id}
          type="file"
          accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
          disabled={busy}
          onChange={(event) => {
            if (event.currentTarget.files) choose(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
      </div>
      {busy && <output aria-live="polite">正在导入{lastFile ? ` ${lastFile.name}` : ""}…</output>}
      {error && (
        <Notice
          actions={
            lastFile ? (
              <Button disabled={busy} onClick={() => void importFile(lastFile)}>
                重试导入
              </Button>
            ) : undefined
          }
        >
          {error}
        </Notice>
      )}
    </section>
  );
}
