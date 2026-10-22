import { useState } from "react";
import type { CreationOperation } from "../../bindings/workbench";
import { SourceImageView } from "./SourceImageView";
import { operationLabel } from "../workbench/image-operation";

/** Frozen image conditioning remains visible independently from the current creation. */
export function SubmissionImageInput({ operation }: { operation: CreationOperation }) {
  const [open, setOpen] = useState(false);
  if (operation.kind === "textToImage") return null;
  return (
    <details
      className="generation-input-details"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{operationLabel(operation)} · 源图与专有参数</summary>
      <dl className="generation-metadata">
        <div>
          <dt>源图身份</dt>
          <dd>{operation.assetId}</dd>
        </div>
        {operation.kind === "imageToImage" && (
          <>
            <div>
              <dt>Strength</dt>
              <dd>{operation.strength}</dd>
            </div>
            <div>
              <dt>Noise</dt>
              <dd>{operation.noise}</dd>
            </div>
            <div>
              <dt>颜色校正</dt>
              <dd>{operation.colorCorrect ? "开启" : "关闭"}</dd>
            </div>
            <div>
              <dt>额外噪声种子</dt>
              <dd>{operation.extraNoiseSeed ?? "未指定"}</dd>
            </div>
            <div>
              <dt>保留原图</dt>
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
    </details>
  );
}
