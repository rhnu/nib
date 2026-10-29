import { useLayoutEffect, useRef, useState } from "react";
import { Image } from "lucide-react";
import type { MediaAsset } from "../../bindings/media";
import { errorMessage } from "../../shared/host/error";
import { Button, FilePicker, Notice } from "../../shared/ui";
import { importAndCommitImage } from "./image-import";
import { mediaApi } from "./api";
import { singleImageFile } from "./model";
import "./media.css";

export function ImageImporter({
  onImported,
  onChooseExisting,
  label = "选择文件",
}: {
  onImported: (asset: MediaAsset) => void | Promise<void>;
  onChooseExisting?: () => void;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const latest = useRef({ active: true, locked: false, onImported });
  useLayoutEffect(() => {
    latest.current.onImported = onImported;
  }, [onImported]);
  useLayoutEffect(() => {
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
      await importAndCommitImage({
        file,
        importImage: mediaApi.importImage,
        commit: (asset) => latest.current.onImported(asset),
        isCurrent: () => latest.current.active,
      });
      if (latest.current.active) setLastFile(null);
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
        <FilePicker
          disabled={busy}
          title="选择或拖入单张 PNG / JPEG / WebP"
          label={busy ? "正在保存图片…" : label}
          accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
          onChoose={(file) => choose([file])}
        />
        {onChooseExisting && (
          <Button disabled={busy} onClick={onChooseExisting}>
            <Image size={14} aria-hidden />
            已有媒体
          </Button>
        )}
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
