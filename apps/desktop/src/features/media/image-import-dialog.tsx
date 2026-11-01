import { useState } from "react";
import { ImagePlus, ScanFace, Waves, FileInput } from "lucide-react";
import type { MediaAsset } from "@/bindings/media";
import type { Draft, ModelCapabilities, VibeReferenceInput } from "@/bindings/workbench";
import { t, useTranslation, errorMessage, MessageError, deferMessage } from "@/shared/i18n";
import { Button, IconButton, Modal, Notice, Select } from "@/shared/ui";
import { VibeMaterialDialog } from "@/features/vibes/vibe-material-dialog";
import { showVibeReferences } from "@/features/vibes/model";
import { useVibeAction } from "@/features/vibes/use-vibe-action";
import { AssetImage } from "./asset-image";
import { mediaApi } from "./api";
import { useMediaQuery } from "./use-media-query";
import { ImageMetadataFields } from "./image-metadata-dialog";
import type { MetadataImportMode, MetadataSelection } from "./metadata-import";
import "./media.css";

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
      className="media-import-modal"
      title={t("media.droppedImage")}
      onClose={onClose}
    >
      <div className="media-import-dialog">
        <div className="media-import-top">
          <div className="media-import-image">
            <AssetImage asset={asset} alt={t("media.droppedImage")} />
            <fieldset className="media-import-actions" aria-label={t("media.imageUses")}>
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
            </fieldset>
          </div>
          <section
            className="metadata-import-options"
            aria-label={t("media.importSelectedMetadata")}
          >
            <h3>{t("media.importSelectedMetadata")}</h3>
            <div className="metadata-import-fields">
              {(Object.keys(selection) as (keyof MetadataSelection)[]).map((key) => (
                <label key={key}>
                  <input
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
            </div>
            <div className="metadata-import-submit">
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
                className="primary"
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
            </div>
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
          </section>
        </div>
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
      </div>
    </Modal>
  );
}
