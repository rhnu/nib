import { Button, Col, Grid } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";
import { useState } from "react";
import type { CreationOperation } from "@/bindings/workbench";
import { SourceImageView } from "../results/source-image-view";
import { operationLabel } from "@/features/inputs/image-operation";
import { AssetImage } from "@/features/media/asset-image";
import { useMediaAsset } from "@/features/media/use-media-asset";

function SubmittedMask({ id }: { id: string }) {
  useTranslation();

  const media = useMediaAsset(id);
  return (
    <Col
      gap={0}
      align="stretch"
      className="generation-source-view flex flex-1 min-w-0 min-h-0 flex-col gap-[10px] overflow-auto p-space-4"
    >
      {media.error ? (
        <div role="alert">
          {media.error}
          <Button onClick={media.retry}>{t("generation.retryLoadMask")}</Button>
        </div>
      ) : media.asset ? (
        <>
          <div className="generation-canvas-metadata overflow-hidden whitespace-nowrap text-ellipsis generation-muted text-muted">
            {t("generation.appliedMaskPrefix")}
            {media.asset.width} × {media.asset.height}
          </div>
          <AssetImage
            asset={media.asset}
            alt={t("generation.submittedMask")}
            className="generation-source-image block w-full min-h-0 flex-1 object-contain"
          />
        </>
      ) : (
        <output>{t("generation.loadingSubmittedMask")}</output>
      )}
    </Col>
  );
}

function ConditioningMetadata({
  strength,
  noise,
  colorCorrect,
  noiseSeed,
  seed,
}: {
  strength: number;
  noise: number;
  colorCorrect: boolean;
  noiseSeed: number | null;
  seed?: number;
}) {
  useTranslation();

  return (
    <>
      <div>
        <dt>{t("generation.strength")}</dt>
        <dd>{strength}</dd>
      </div>
      <div>
        <dt>{t("generation.noise")}</dt>
        <dd>{noise}</dd>
      </div>
      <div>
        <dt>{t("generation.colorCorrection")}</dt>
        <dd>{colorCorrect ? t("generation.on") : t("generation.off")}</dd>
      </div>
      <div>
        <dt>{t("generation.extraNoiseSeed")}</dt>
        <dd>
          {noiseSeed ??
            (seed !== undefined
              ? t("generation.inheritedSeedValue", { value0: seed })
              : t("generation.inheritSubmissionSeed"))}
        </dd>
      </div>
    </>
  );
}

/** Frozen image conditioning remains visible independently from the current creation. */
export function SubmissionImageInput({
  operation,
  seed,
}: {
  operation: CreationOperation;
  seed?: number;
}) {
  useTranslation();

  const [open, setOpen] = useState(false);
  if (operation.kind === "textToImage") return null;
  return (
    <details
      className="generation-input-details [&_>_.generation-source-view]:h-[240px] my-space-4 mx-0 text-label"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {operationLabel(operation)} ·{" "}
        {operation.kind === "inpainting"
          ? t("generation.sourceMaskParameters")
          : t("generation.sourceParameters")}
      </summary>
      <Grid
        gap={0}
        align="stretch"
        columns={1}
        as="dl"
        className="generation-metadata [&_>_div]:grid-cols-[76px_minmax(0,_1fr)] [&_dt]:text-muted [&_dd]:wrap-anywhere [&_>_div]:grid [&_>_div]:gap-space-3 [&_dd]:m-0 grid gap-space-3 m-0 text-label"
      >
        {operation.kind === "imageToImage" && (
          <>
            <ConditioningMetadata
              strength={operation.strength}
              noise={operation.noise}
              colorCorrect={operation.colorCorrect}
              noiseSeed={operation.extraNoiseSeed}
              seed={seed}
            />
            <Grid gap={3} columns={1} className="grid-cols-[76px_minmax(0,1fr)]">
              <dt>{t("generation.keepOriginal")}</dt>
              <dd>{operation.addOriginalImage ? t("generation.on") : t("generation.off")}</dd>
            </Grid>
          </>
        )}
        {operation.kind === "inpainting" && (
          <>
            <Grid gap={3} columns={1} className="grid-cols-[76px_minmax(0,1fr)]">
              <dt>{t("generation.regionalConditioning")}</dt>
              <dd>
                {operation.img2img
                  ? t("generation.regionalImageToImage")
                  : t("generation.pureInpainting")}
              </dd>
            </Grid>
            {operation.img2img && (
              <ConditioningMetadata
                strength={operation.img2img.strength}
                noise={operation.img2img.noise}
                colorCorrect={operation.img2img.color_correct}
                noiseSeed={operation.img2img.extra_noise_seed}
                seed={seed}
              />
            )}
            <Grid gap={3} columns={1} className="grid-cols-[76px_minmax(0,1fr)]">
              <dt>{t("generation.keepOutsideMask")}</dt>
              <dd>{operation.addOriginalImage ? t("generation.on") : t("generation.off")}</dd>
            </Grid>
          </>
        )}
        {operation.kind === "upscale" && (
          <>
            <Grid gap={3} columns={1} className="grid-cols-[76px_minmax(0,1fr)]">
              <dt>{t("generation.model")}</dt>
              <dd>{operation.model}</dd>
            </Grid>
            <Grid gap={3} columns={1} className="grid-cols-[76px_minmax(0,1fr)]">
              <dt>{t("generation.blurSigma")}</dt>
              <dd>{operation.declaredBlurSigma}</dd>
            </Grid>
          </>
        )}
      </Grid>
      {open && <SourceImageView id={operation.assetId} />}
      {open && operation.kind === "inpainting" && <SubmittedMask id={operation.maskAssetId} />}
    </details>
  );
}
