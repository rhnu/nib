import { Grid, Row, Button, FilePicker, Notice } from "@/shared/ui";

import { t, useTranslation, useMessageState, deferMessage } from "@/shared/i18n";
import { useLayoutEffect, useRef, useState } from "react";
import { Image } from "lucide-react";
import type { MediaAsset } from "@/bindings/media";

import { importAndCommitImage } from "./image-import";
import { droppedImage } from "./image-drop";
import { trackPendingWork } from "@/shared/host/pending-work";
import { mediaApi } from "./api";
import { singleImageFile } from "./model";

export function ImageImporter({
  onImported,
  onChooseExisting,
  label = t("media.chooseFile"),
}: {
  onImported: (asset: MediaAsset) => void | Promise<void>;
  onChooseExisting?: () => void;
  label?: string;
}) {
  useTranslation();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useMessageState();
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
      if (latest.current.active) setError(cause);
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
    <Grid
      align="stretch"
      as="section"
      gap={0}
      columns={1}
      minColumnWidth="0px"
      className="image-importer [&_.help-note]:m-0 grid gap-space-3 min-w-0"
      aria-label={t("media.importImage")}
      aria-busy={busy}
    >
      <Row
        gap={0}
        className={`image-drop-target [&.is-dragging]:border-accent [&.is-dragging]:bg-accent-soft flex items-center flex-wrap gap-space-2 p-[5px] [border:1px_dashed_var(--line)] rounded-control bg-background ${dragging ? "is-dragging" : ""}`}
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
          const input = droppedImage(event.dataTransfer);
          if (!input) {
            setError(deferMessage(() => t("media.dropSingleImage")));
            return;
          }
          if (input.kind === "file") {
            choose([input.file]);
            return;
          }
          if (latest.current.locked) return;
          latest.current.locked = true;
          setLastFile(null);
          setBusy(true);
          setError(null);
          void trackPendingWork(
            (async () => {
              const asset = await mediaApi.importRemoteImage(input.url);
              if (latest.current.active) await latest.current.onImported(asset);
            })(),
          )
            .catch((cause: unknown) => {
              if (latest.current.active) setError(cause);
            })
            .finally(() => {
              latest.current.locked = false;
              if (latest.current.active) setBusy(false);
            });
        }}
      >
        <FilePicker
          disabled={busy}
          title={t("media.chooseOrDropImage")}
          label={busy ? t("media.savingImage") : label}
          accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
          onChoose={(file) => choose([file])}
        />
        {onChooseExisting && (
          <Button disabled={busy} onClick={onChooseExisting}>
            <Image size={14} aria-hidden />
            {t("media.existingMedia")}
          </Button>
        )}
      </Row>
      {busy && (
        <output aria-live="polite">
          {t("media.importing")}
          {lastFile ? ` ${lastFile.name}` : ""}…
        </output>
      )}
      {error && (
        <Notice
          actions={
            lastFile ? (
              <Button disabled={busy} onClick={() => void importFile(lastFile)}>
                {t("media.retryImport")}
              </Button>
            ) : undefined
          }
        >
          {error}
        </Notice>
      )}
    </Grid>
  );
}
