import { useState } from "react";
import type { CreationOperation } from "../../bindings/workbench";
import { SourceImageView } from "./SourceImageView";
import { operationLabel } from "../workbench/image-operation";
import { AssetImage } from "../media/AssetImage";
import { useMediaAsset } from "../media/useMediaAsset";
import { Button } from "../../shared/ui";

function SubmittedMask({ id }: { id: string }) {
  const media = useMediaAsset(id);
  return (
    <div className="generation-source-view">
      {media.error ? (
        <div role="alert">
          {media.error}
          <Button onClick={media.retry}>重试读取遮罩</Button>
        </div>
      ) : media.asset ? (
        <>
          <div className="generation-canvas-metadata generation-muted">
            已应用遮罩 · {media.asset.width} × {media.asset.height}
          </div>
          <AssetImage
            asset={media.asset}
            alt="提交时已应用的局部重绘遮罩"
            className="generation-source-image"
          />
        </>
      ) : (
        <output>正在读取提交遮罩…</output>
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
  return (
    <>
      <div>
        <dt>Strength</dt>
        <dd>{strength}</dd>
      </div>
      <div>
        <dt>Noise</dt>
        <dd>{noise}</dd>
      </div>
      <div>
        <dt>颜色校正</dt>
        <dd>{colorCorrect ? "开启" : "关闭"}</dd>
      </div>
      <div>
        <dt>额外噪声种子</dt>
        <dd>{noiseSeed ?? (seed !== undefined ? `${seed}（跟随提交种子）` : "跟随提交种子")}</dd>
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
  const [open, setOpen] = useState(false);
  if (operation.kind === "textToImage") return null;
  return (
    <details
      className="generation-input-details"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {operationLabel(operation)} ·{" "}
        {operation.kind === "inpainting" ? "源图、遮罩与参数" : "源图与专有参数"}
      </summary>
      <dl className="generation-metadata">
        <div>
          <dt>源图身份</dt>
          <dd>{operation.assetId}</dd>
        </div>
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
              <dt>保留原图</dt>
              <dd>{operation.addOriginalImage ? "开启" : "关闭"}</dd>
            </div>
          </>
        )}
        {operation.kind === "inpainting" && (
          <>
            <div>
              <dt>遮罩身份</dt>
              <dd>{operation.maskAssetId}</dd>
            </div>
            <div>
              <dt>局部条件</dt>
              <dd>{operation.img2img ? "局部图生图" : "纯补绘"}</dd>
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
              <dt>保留遮罩外原图</dt>
              <dd>{operation.addOriginalImage ? "开启" : "关闭"}</dd>
            </div>
          </>
        )}
        {operation.kind === "upscale" && (
          <>
            <div>
              <dt>模型</dt>
              <dd>{operation.model}</dd>
            </div>
            <div>
              <dt>Blur Sigma</dt>
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
