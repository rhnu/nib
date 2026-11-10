import { ActionsMenu, notify, type ActionMenuItem } from "@/shared/ui";

import { useState } from "react";
import { Copy, Download } from "lucide-react";
import type { ImageExportFormat } from "@/bindings/media";
import { t, useTranslation } from "@/shared/i18n";
import { errorMessage } from "@/shared/host/error";

import { saveExportFile } from "@/shared/host/file-export";
import { mediaApi } from "./api";

/** All entry points use the same format names and ordering. */
export function imageExportFormatItems(
  mimeType: string | undefined,
  action: (format: ImageExportFormat) => void,
): ActionMenuItem[] {
  return [
    {
      label: t(mimeType === "image/png" ? "media.exportOriginalPng" : "media.exportOriginal"),
      action: () => action("original"),
    },
    { label: t("media.exportCleanPng"), action: () => action("cleanPng") },
    { label: t("media.exportJpg"), action: () => action("jpeg") },
  ];
}

/** The host only returns supported, validated image encodings. */
export function exportedImageFile(bytes: ArrayBuffer, filename: string) {
  const signature = new Uint8Array(bytes);
  const jpeg = signature[0] === 0xff;
  const png = signature[0] === 0x89;
  const extension = jpeg ? "jpg" : png ? "png" : "webp";
  const mimeType = jpeg ? "image/jpeg" : png ? "image/png" : "image/webp";
  return { filename: filename.replace(/\.[^./\\]+$/, "") + "." + extension, mimeType };
}

export function saveExportedImage(bytes: ArrayBuffer, filename: string) {
  return saveExportFile(bytes, exportedImageFile(bytes, filename).filename);
}

/** Copy and save share encoding while each surface retains its own error presentation. */
export function useImageExport({
  id,
  mimeType,
  filename = `nib-${id}`,
  available,
}: {
  id: string;
  mimeType: string;
  filename?: string;
  available: boolean;
}) {
  useTranslation();
  const [busy, setBusy] = useState(false);

  const run = async (action: "save" | "copy", format: ImageExportFormat) => {
    if (!available || busy) return;
    setBusy(true);
    try {
      if (action === "copy") {
        await mediaApi.copyImage(id, format);
        notify(() => t("common.imageCopied"), "copy-image");
      } else {
        await saveExportedImage(await mediaApi.exportImage(id, format), filename);
      }
    } catch (cause) {
      notify(
        () =>
          t(action === "copy" ? "common.imageCopyFailed" : "common.imageActionFailed", {
            detail: errorMessage(cause),
          }),
        `${action}-image`,
        true,
      );
    } finally {
      setBusy(false);
    }
  };

  const disabled = !available || busy;
  const saveItems = imageExportFormatItems(mimeType, (format) => void run("save", format));
  const copyItems = imageExportFormatItems(mimeType, (format) => void run("copy", format));
  const items: ActionMenuItem[] = [
    { label: t("media.saveImage"), disabled, items: saveItems },
    { label: t("common.copyImage"), disabled, items: copyItems },
  ];
  return { items, saveItems, copyItems, disabled };
}

export function ImageFormatMenu({
  action,
  mimeType,
  disabled,
  onSelect,
}: {
  action: "save" | "copy";
  mimeType?: string;
  disabled?: boolean;
  onSelect: (format: ImageExportFormat) => void;
}) {
  useTranslation();
  return (
    <ActionsMenu
      label={t(action === "save" ? "media.saveImage" : "common.copyImage")}
      disabled={disabled}
      icon={action === "save" ? <Download size={17} aria-hidden /> : <Copy size={17} aria-hidden />}
      items={imageExportFormatItems(mimeType, onSelect)}
    />
  );
}

/** Compact export controls for image-producing tools outside the gallery. */
export function ImageExportActions(props: Parameters<typeof useImageExport>[0]) {
  const image = useImageExport(props);
  return (
    <>
      <ActionsMenu
        label={t("media.saveImage")}
        icon={<Download size={17} aria-hidden />}
        disabled={image.disabled}
        items={image.saveItems}
      />
      <ActionsMenu
        label={t("common.copyImage")}
        icon={<Copy size={17} aria-hidden />}
        disabled={image.disabled}
        items={image.copyItems}
      />
    </>
  );
}
