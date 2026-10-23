import type { VibeAssetInspection } from "../../bindings/media";
import { mediaApi } from "../media/api";
import { useMediaQuery } from "../media/useMediaQuery";
import { Button, Notice } from "../../shared/ui";
import type { VibeEncodingInput } from "../../bindings/workbench";
import { useVibeAction } from "./useVibeAction";
import { useLayoutEffect, useRef } from "react";

export function VibeAssetInformation({
  id,
  inspection,
  onEncode,
}: {
  id: string;
  inspection: VibeAssetInspection;
  onEncode?: (input: VibeEncodingInput) => void;
}) {
  const action = useVibeAction();
  const latest = useRef(onEncode);
  useLayoutEffect(() => {
    latest.current = onEncode;
  }, [onEncode]);
  return (
    <>
      <dl className="vibe-identity">
        <div>
          <dt>模型</dt>
          <dd>{inspection.modelKey ?? "未记录"}</dd>
        </div>
        <div>
          <dt>信息提取量</dt>
          <dd>{inspection.informationExtracted ?? "未记录"}</dd>
        </div>
        {!inspection.hasSourceImage && (
          <div>
            <dt>原图</dt>
            <dd>未保留，无法调整编码参数</dd>
          </div>
        )}
        {inspection.hasSourceImage && inspection.sourceDocument && (
          <div>
            <dt>原图</dt>
            <dd>保存在文档中</dd>
          </div>
        )}
      </dl>
      {inspection.parameterKey && (
        <details>
          <summary>编码详情</summary>
          <code className="vibe-cache-key">{inspection.parameterKey}</code>
        </details>
      )}
      {action.error && <Notice>{action.error}</Notice>}
      {onEncode && inspection.canReencode && (
        <Button
          disabled={action.busy}
          onClick={() =>
            void action.run(async (active) => {
              const input = await mediaApi.prepareVibeReencoding(id);
              if (active()) latest.current?.(input);
            })
          }
        >
          {action.busy ? "正在准备…" : "重新编码"}
        </Button>
      )}
    </>
  );
}

export function VibeAssetDetails({
  id,
  onEncode,
}: {
  id: string;
  onEncode?: (input: VibeEncodingInput) => void;
}) {
  const view = useMediaQuery(id, mediaApi.inspectVibeAsset);
  if (view.loading) return <output className="vibe-status">正在读取编码信息…</output>;
  if (view.error)
    return <Notice actions={<Button onClick={view.retry}>重试</Button>}>{view.error}</Notice>;
  return view.value ? (
    <VibeAssetInformation id={id} inspection={view.value} onEncode={onEncode} />
  ) : null;
}
