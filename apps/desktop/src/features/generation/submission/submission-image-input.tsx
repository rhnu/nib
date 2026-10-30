import { t, useTranslation } from "@/shared/i18n";
import { useState } from "react";
import type { CreationOperation } from "@/bindings/workbench";
import { SourceImageView } from "../results/source-image-view";
import { operationLabel } from "@/features/inputs/image-operation";
import { AssetImage } from "@/features/media/asset-image";
import { useMediaAsset } from "@/features/media/use-media-asset";
import { Button } from "@/shared/ui";

function SubmittedMask({ id }: { id: string }) {
  useTranslation();

  const media = useMediaAsset(id);
  return (
    <div className="generation-source-view">
      {media.error ? (
        <div role="alert">
          {media.error}
          <Button onClick={media.retry}>{t("generation.retryLoadMask")}</Button>
        </div>
      ) : media.asset ? (
        <>
          <div className="generation-canvas-metadata generation-muted">
            {t("generation.appliedMaskPrefix")}
            {media.asset.width} × {media.asset.height}
          </div>
          <AssetImage
            asset={media.asset}
            alt={t("generation.submittedMask")}
            className="generation-source-image"
          />
        </>
      ) : (
        <output>{t("generation.loadingSubmittedMask")}</output>
      )}
    </div>
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
      className="generation-input-details"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {operationLabel(operation)} ·{" "}
        {operation.kind === "inpainting"
          ? t("generation.sourceMaskParameters")
          : t("generation.sourceParameters")}
      </summary>
      <dl className="generation-metadata">
        {operation.kind === "imageToImage" && (
          <>
            <ConditioningMetadata
              strength={operation.strength}
              noise={operation.noise}
              colorCorrect={operation.colorCorrect}
              noiseSeed={operation.extraNoiseSeed}
              seed={seed}
            />
            <div>
              <dt>{t("generation.keepOriginal")}</dt>
              <dd>{operation.addOriginalImage ? t("generation.on") : t("generation.off")}</dd>
            </div>
          </>
        )}
        {operation.kind === "inpainting" && (
          <>
            <div>
              <dt>{t("generation.regionalConditioning")}</dt>
              <dd>
                {operation.img2img
                  ? t("generation.regionalImageToImage")
                  : t("generation.pureInpainting")}
              </dd>
            </div>
            {operation.img2img && (
              <ConditioningMetadata
                strength={operation.img2img.strength}
                noise={operation.img2img.noise}
                colorCorrect={operation.img2img.color_correct}
                noiseSeed={operation.img2img.extra_noise_seed}
                seed={seed}
              />
            )}
            <div>
              <dt>{t("generation.keepOutsideMask")}</dt>
              <dd>{operation.addOriginalImage ? t("generation.on") : t("generation.off")}</dd>
            </div>
          </>
        )}
        {operation.kind === "upscale" && (
          <>
            <div>
              <dt>{t("generation.model")}</dt>
              <dd>{operation.model}</dd>
            </div>
            <div>
              <dt>{t("generation.blurSigma")}</dt>
              <dd>{operation.declaredBlurSigma}</dd>
            </div>
          </>
        )}
      </dl>
      {open && <SourceImageView id={operation.assetId} />}
      {open && operation.kind === "inpainting" && <SubmittedMask id={operation.maskAssetId} />}
    </details>
  );
}
