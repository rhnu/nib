import { useLayoutEffect, useRef } from "react";
import type { ResultSummary } from "../../bindings/generation";
import type { VibeEncodingInput, VibeReferenceInput } from "../../bindings/workbench";
import { Button, Notice } from "../../shared/ui";
import { mediaApi } from "../media/api";
import { useMediaQuery } from "../media/useMediaQuery";
import { VibeAssetInformation } from "./VibeAssetDetails";
import { downloadBytes } from "./model";
import { useVibeAction } from "./useVibeAction";
import "./vibes.css";

export function VibeResultCard({
  result,
  onAddReference,
  onEncode,
}: {
  result: ResultSummary;
  onAddReference?: (value: VibeReferenceInput) => void;
  onEncode?: (input: VibeEncodingInput) => void;
}) {
  const action = useVibeAction();
  const inspection = useMediaQuery(
    result.available ? result.assetId : null,
    mediaApi.inspectVibeAsset,
  );
  const latest = useRef(onAddReference);
  useLayoutEffect(() => {
    latest.current = onAddReference;
  }, [onAddReference]);
  return (
    <article className="vibe-result-card">
      <header>
        <h3>Vibe 编码</h3>
        <time dateTime={new Date(result.createdAt).toISOString()}>
          {new Date(result.createdAt).toLocaleString()}
        </time>
      </header>
      {inspection.loading && <output>正在读取编码信息…</output>}
      {result.available ? (
        inspection.value && (
          <VibeAssetInformation
            id={result.assetId}
            inspection={inspection.value}
            onEncode={onEncode}
          />
        )
      ) : (
        <p className="vibe-message">编码文件不可用</p>
      )}
      {result.operation.kind === "encodeVibe" && (
        <dl className="vibe-identity">
          <div>
            <dt>源图</dt>
            <dd>{result.operation.input.assetId}</dd>
          </div>
          {result.operation.input.maskAssetId && (
            <div>
              <dt>遮罩</dt>
              <dd>
                {result.operation.input.maskAssetId}
                {result.operation.input.cropToMask ? " · 裁剪" : ""}
              </dd>
            </div>
          )}
          <div>
            <dt>Focus seed</dt>
            <dd>{result.operation.input.focusSeed ?? "自动"}</dd>
          </div>
          <div>
            <dt>Extract seed</dt>
            <dd>{result.operation.input.infoExtractSeed ?? "自动"}</dd>
          </div>
        </dl>
      )}
      {inspection.error && (
        <Notice actions={<Button onClick={inspection.retry}>重试</Button>}>
          {inspection.error}
        </Notice>
      )}
      {action.error && <Notice>{action.error}</Notice>}
      <div className="vibe-toolbar">
        {onAddReference && (
          <Button
            className="primary"
            disabled={!result.available || action.busy}
            onClick={() =>
              void action.run(async (active) => {
                const value = await mediaApi.createVibeReference(result.assetId);
                if (active()) latest.current?.(value);
              })
            }
          >
            添加到参考
          </Button>
        )}
        <Button
          disabled={!result.available || action.busy || !inspection.value?.canExportDocument}
          onClick={() =>
            void action.run(async (active) => {
              const document = await mediaApi.createEncodedVibeDocument(result.assetId);
              if (!active()) return;
              const bytes = await mediaApi.exportVibeDocument(document.id);
              if (active()) downloadBytes(bytes, `nib-${result.jobId}.naiv4vibe`);
            })
          }
        >
          导出单文件
        </Button>
        <Button
          disabled={!result.available || action.busy}
          onClick={() =>
            void action.run(async (active) => {
              const bytes = await mediaApi.content(result.assetId);
              if (active())
                downloadBytes(bytes, `nib-${result.jobId}.bin`, "application/octet-stream");
            })
          }
        >
          导出编码
        </Button>
      </div>
    </article>
  );
}
