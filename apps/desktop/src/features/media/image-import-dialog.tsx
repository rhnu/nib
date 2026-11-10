import { Col, Grid, Row, Input, Button, IconButton, Modal, Notice, Select } from "@/shared/ui";

import { useState } from "react";
import { ImagePlus, ScanFace, Waves, FileInput } from "lucide-react";
import type { MediaAsset } from "@/bindings/media";
import type { Draft, ModelCapabilities, VibeReferenceInput } from "@/bindings/workbench";
import { t, useTranslation, errorMessage, MessageError, deferMessage } from "@/shared/i18n";

import { VibeMaterialDialog } from "@/features/vibes/vibe-material-dialog";
import { showVibeReferences } from "@/features/vibes/model";
import { useVibeAction } from "@/features/vibes/use-vibe-action";
import { AssetImage } from "./asset-image";
import { mediaApi } from "./api";
import { useMediaQuery } from "./use-media-query";
import { ImageMetadataFields } from "./image-metadata-dialog";
import type { MetadataImportMode, MetadataSelection } from "./metadata-import";

/** Keep image uses and direct metadata import together above the recorded source text. */
export function ImageImportDialog({
  asset,
  capabilities,
  onClose,
  onSource,
  onReference,
  onEncode,
  onImportMetadata,
  onVibes,
}: {
  asset: MediaAsset;
  capabilities: ModelCapabilities | null;
  onClose: () => void;
  onSource: () => void;
  onReference: (kind: "precise" | "vibe") => void;
  onEncode: () => void;
  onImportMetadata: (draft: Draft, selection: MetadataSelection, mode: MetadataImportMode) => void;
  onVibes: (values: VibeReferenceInput[], mode: "append" | "replace") => void;
}) {
  useTranslation();
  const report = useMediaQuery(["media", "metadata", asset.id], asset.id, mediaApi.metadata);
  const [selection, setSelection] = useState<MetadataSelection>({
    prompt: true,
    negativePrompt: true,
    characters: true,
    settings: false,
    seed: false,
  });
  const [mode, setMode] = useState<MetadataImportMode>("append");
  const [materialId, setMaterialId] = useState<string | null>(null);
  const action = useVibeAction();
  const metadata = report.value?.generation;
  const available = {
    prompt: metadata?.prompt != null,
    negativePrompt: metadata?.negativePrompt != null,
    characters: Boolean(metadata?.characters.length),
    settings: Boolean(
      metadata &&
      [
        metadata.model,
        metadata.size,
        metadata.steps,
        metadata.sampler,
        metadata.scale,
        metadata.noiseSchedule,
        metadata.cfgRescale,
      ].some((value) => value !== null),
    ),
    seed: metadata?.seed != null,
  };
  const selected = Object.fromEntries(
    Object.entries(selection).map(([key, value]) => [
      key,
      value && available[key as keyof MetadataSelection],
    ]),
  ) as MetadataSelection;
  const canImport = Object.values(selected).some(Boolean);
  const vibe = capabilities !== null && showVibeReferences(capabilities);
  const imageVibe = capabilities?.vibeInputPath === "image";

  const choose = (apply: () => void) => {
    apply();
    onClose();
  };

  if (materialId)
    return (
      <VibeMaterialDialog
        open
        initialAssetId={materialId}
        capabilities={capabilities}
        onClose={() => setMaterialId(null)}
        onSelect={(values, nextMode) => {
          onVibes(values, nextMode);
          onClose();
        }}
      />
    );

  return (
    <Modal
      open
      wide
      className="media-import-modal [.modal&]:w-[min(1120px,_calc(100vw_-_48px))] [.modal&]:max-w-[calc(100vw_-_48px)] [.modal&]:h-[min(760px,_calc(100dvh_-_var(--titlebar-height)_-_48px))] [.modal&]:max-h-[calc(100dvh_-_var(--titlebar-height)_-_48px)]"
      title={t("media.droppedImage")}
      onClose={onClose}
    >
      <Col
        gap={0}
        className="media-import-dialog [&_.media-character-content_>_h3]:mt-0 [&_.media-character-content_>_div_>_h4]:mt-space-3 overflow-auto p-[20px] min-h-0 flex flex-col gap-space-5"
      >
        <Grid
          columns={1}
          gap={0}
          minColumnWidth="0px"
          className="media-import-top grid grid-cols-[minmax(180px,_280px)_minmax(0,_1fr)] items-start gap-space-6"
        >
          <div className="media-import-image [&_.media-image]:max-h-[220px] [&_.media-image]:w-full relative min-w-0">
            <AssetImage asset={asset} alt={t("media.droppedImage")} />
            <Row
              align="stretch"
              as="fieldset"
              gap={0}
              className="media-import-actions absolute left-[50%] bottom-[8px] [transform:translateX(-50%)] flex gap-space-1 p-space-1 m-0 [border:1px_solid_var(--line)] rounded-control bg-raised"
              aria-label={t("media.imageUses")}
            >
              <IconButton
                label={t("inputs.imageToImage")}
                disabled={!capabilities || action.busy}
                onClick={() => choose(onSource)}
              >
                <ImagePlus size={18} aria-hidden />
              </IconButton>
              <IconButton
                label={imageVibe ? t("explore.useVibe") : t("media.prepareVibe")}
                disabled={!vibe || action.busy}
                onClick={() => choose(() => (imageVibe ? onReference("vibe") : onEncode()))}
              >
                <Waves size={18} aria-hidden />
              </IconButton>
              <IconButton
                label={t("explore.usePrecise")}
                disabled={!capabilities?.canAddPreciseReference || action.busy}
                onClick={() => choose(() => onReference("precise"))}
              >
                <ScanFace size={18} aria-hidden />
              </IconButton>
            </Row>
          </div>
          <Grid
            align="stretch"
            as="section"
            gap={0}
            columns={1}
            minColumnWidth="0px"
            className="metadata-import-options [&_>_h3]:m-0 [&_>_h3]:text-section grid content-start gap-space-5 min-w-0"
            aria-label={t("media.importSelectedMetadata")}
          >
            <h3>{t("media.importSelectedMetadata")}</h3>
            <Grid
              columns={1}
              align="stretch"
              gap={0}
              minColumnWidth="0px"
              className="metadata-import-fields [&_label]:flex [&_label]:items-center [&_label]:gap-space-2 grid  gap-[12px_18px]"
            >
              {(Object.keys(selection) as (keyof MetadataSelection)[]).map((key) => (
                <label key={key}>
                  <Input
                    type="checkbox"
                    checked={selected[key]}
                    disabled={!available[key] || action.busy}
                    onChange={(event) =>
                      setSelection({ ...selection, [key]: event.target.checked })
                    }
                  />
                  {t(`media.importField_${key}`)}
                </label>
              ))}
            </Grid>
            <Row
              gap={0}
              className="metadata-import-submit [&_>_.select-trigger]:w-[120px] flex items-center gap-[10px]"
            >
              <Select
                value={mode}
                aria-label={t("media.importMode")}
                disabled={action.busy}
                onValueChange={(value) => setMode(value === "replace" ? "replace" : "append")}
                options={[
                  { value: "append", label: t("media.appendMetadata") },
                  { value: "replace", label: t("media.replaceMetadata") },
                ]}
              />
              <Button
                variant="primary"
                className=""
                disabled={!canImport || action.busy}
                onClick={() =>
                  void action.run(async (active) => {
                    const value = await mediaApi.restoreMetadata(asset.id);
                    if (active()) choose(() => onImportMetadata(value.draft, selected, mode));
                  })
                }
              >
                {t("media.importSelectedMetadata")}
              </Button>
            </Row>
            {(report.value?.hasVibeDocument || (metadata?.embeddedVibeCount ?? 0) > 0) && (
              <Button
                disabled={action.busy || !vibe}
                onClick={() =>
                  void action.run(async (active) => {
                    const material = report.value?.hasVibeDocument
                      ? await mediaApi.importPngVibeDocument(asset.id)
                      : (await mediaApi.embeddedVibes(asset.id))[0];
                    if (!active()) return;
                    if (!material)
                      throw new MessageError(deferMessage(() => t("vibes.noUsableEncoding")));
                    setMaterialId(material.id);
                  })
                }
              >
                <FileInput size={16} aria-hidden />
                {t("media.inspectEmbeddedVibes")}
              </Button>
            )}
          </Grid>
        </Grid>
        {report.loading && <output>{t("media.inspectingMetadata")}</output>}
        {report.error && (
          <Notice actions={<Button onClick={report.retry}>{t("media.retryInspection")}</Button>}>
            {report.error}
          </Notice>
        )}
        {report.value?.warnings.map((warning, index) => (
          <Notice key={index}>{errorMessage(warning)}</Notice>
        ))}
        {metadata && <ImageMetadataFields metadata={metadata} />}
        {action.error && <Notice>{action.error}</Notice>}
      </Col>
    </Modal>
  );
}
