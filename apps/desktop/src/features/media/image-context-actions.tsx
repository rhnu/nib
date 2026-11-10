import { ContextActions, Button, Modal, Notice, type ActionMenuItem } from "@/shared/ui";

import { useState, type ReactElement } from "react";
import { t, useTranslation } from "@/shared/i18n";

import { useImageExport } from "./image-export";
import { useMediaTools } from "./media-tools-context";
import { useMediaAsset } from "./use-media-asset";
import { ImageMetadataDialog } from "./image-metadata-dialog";
import type { ImageOperationAction } from "@/features/inputs/image-operation";
import type { Draft } from "@/bindings/workbench";
import { ImageSafetyDialog } from "./image-safety-dialog";
import { ImageTagDialog } from "./image-tag-dialog";

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
  const imageExport = useImageExport({ id, mimeType, filename, available });
  const items: ActionMenuItem[] = [
    ...imageExport.items,
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
  return { items, dialogs, imageExport };
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
