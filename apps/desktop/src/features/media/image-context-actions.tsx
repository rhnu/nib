import { useState, type ReactElement } from "react";
import { t, useTranslation } from "@/shared/i18n";
import { errorMessage } from "@/shared/host/error";
import { ContextActions, Button, Modal, Notice, notify, type ActionMenuItem } from "@/shared/ui";
import { mediaApi } from "./api";
import { useMediaTools } from "./media-tools-context";
import { useMediaAsset } from "./use-media-asset";
import { ImageMetadataDialog } from "./image-metadata-dialog";
import type { ImageOperationAction } from "@/features/inputs/image-operation";
import type { Draft } from "@/bindings/workbench";
import { ImageSafetyDialog } from "./image-safety-dialog";
import { ImageTagDialog } from "./image-tag-dialog";

/** Clipboard receives decoded image pixels, never a URL or encoded text. */
async function pngContent(id: string, mimeType: string) {
  const blob = new Blob([await mediaApi.content(id)], { type: mimeType });
  if (mimeType === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable");
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (png) => (png ? resolve(png) : reject(new Error("PNG encoding failed"))),
        "image/png",
      ),
    );
  } finally {
    bitmap.close();
  }
}

export async function copyMediaImage(id: string, mimeType: string) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": pngContent(id, mimeType) })]);
    notify(() => t("common.imageCopied"), "copy-image");
  } catch (cause) {
    notify(() => t("common.imageCopyFailed", { detail: errorMessage(cause) }), "copy-image", true);
  }
}

export async function saveMediaImage(id: string, mimeType: string, filename?: string) {
  try {
    const url = URL.createObjectURL(new Blob([await mediaApi.content(id)], { type: mimeType }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename ?? `nib-${id}.${mimeType.split("/")[1] ?? "png"}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (cause) {
    notify(
      () => t("common.imageActionFailed", { detail: errorMessage(cause) }),
      "save-image",
      true,
    );
  }
}

/** Current workspace operations retain their existing parameter, navigation and confirmation flows. */
export function useImageContextActions({
  id,
  mimeType,
  available,
  filename,
  extraItems = [],
  onImageOperation,
  onRestore,
  canMaxEnhance,
  canInpaint,
}: {
  id: string;
  mimeType: string;
  available: boolean;
  filename?: string;
  extraItems?: ActionMenuItem[];
  onImageOperation?: (id: string, kind: ImageOperationAction) => void;
  onRestore?: (draft: Draft) => void;
  canMaxEnhance?: boolean;
  canInpaint?: boolean;
}) {
  useTranslation();
  const tools = useMediaTools();
  const operate = onImageOperation ?? tools?.onImageOperation;
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const media = useMediaAsset(metadataOpen ? id : null);
  const items: ActionMenuItem[] = [
    {
      label: t("generation.saveOriginal"),
      disabled: !available,
      action: () => void saveMediaImage(id, mimeType, filename),
    },
    {
      label: t("common.copyImage"),
      disabled: !available,
      action: () => void copyMediaImage(id, mimeType),
    },
    {
      label: t("generation.imageInfoRestore"),
      disabled: !available,
      action: () => setMetadataOpen(true),
    },
    { label: t("safety.info"), action: () => setSafetyOpen(true) },
    { label: t("safety.tags"), disabled: !available, action: () => setTagsOpen(true) },
    ...(operate
      ? [
          { separator: true } as const,
          {
            label: t("generation.useAsSource"),
            disabled: !available,
            action: () => operate(id, "imageToImage"),
          },
          {
            label: t("generation.inpainting"),
            disabled: !available || !(canInpaint ?? tools?.canInpaint),
            action: () => operate(id, "inpainting"),
          },
          {
            label: t("generation.maxEnhance"),
            disabled: !available || !(canMaxEnhance ?? tools?.canMaxEnhance),
            action: () => operate(id, "maxEnhance"),
          },
          {
            label: t("generation.upscaleImage"),
            disabled: !available,
            action: () => operate(id, "upscale"),
          },
          ...(tools
            ? [
                {
                  label: t("generation.sendToDirector"),
                  disabled: !available,
                  action: () => tools.onDirector(id),
                },
              ]
            : []),
        ]
      : []),
    ...extraItems,
  ];
  const metadataDialog =
    metadataOpen &&
    (media.asset ? (
      <ImageMetadataDialog
        asset={media.asset}
        onClose={() => setMetadataOpen(false)}
        onRestore={onRestore ?? tools?.onRestore}
      />
    ) : (
      <Modal open title={t("generation.imageInfo")} onClose={() => setMetadataOpen(false)}>
        {media.error ? (
          <Notice actions={<Button onClick={media.retry}>{t("generation.retryLoad")}</Button>}>
            {media.error}
          </Notice>
        ) : (
          <output>{t("generation.loadingImageInfo")}</output>
        )}
      </Modal>
    ));
  const dialogs = (
    <>
      {metadataDialog}
      {safetyOpen && <ImageSafetyDialog assetId={id} onClose={() => setSafetyOpen(false)} />}
      {tagsOpen && <ImageTagDialog key={id} assetId={id} onClose={() => setTagsOpen(false)} />}
    </>
  );
  return { items, dialogs };
}

export function ImageContextActions({
  children,
  deferToAncestor = false,
  ...props
}: Parameters<typeof useImageContextActions>[0] & {
  children: ReactElement;
  deferToAncestor?: boolean;
}) {
  const { items, dialogs } = useImageContextActions(props);
  return (
    <>
      <ContextActions items={items} deferToAncestor={deferToAncestor}>
        {children}
      </ContextActions>
      {dialogs}
    </>
  );
}
