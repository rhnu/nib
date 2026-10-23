import { mediaApi } from "../media/api";
import { useMediaQuery } from "../media/useMediaQuery";
import { Button, Notice } from "../../shared/ui";
import type { VibeEncodingInput } from "../../bindings/workbench";
import { useVibeAction } from "./useVibeAction";
import { useLayoutEffect, useRef } from "react";

export function VibeAssetDetails({
  id,
  onEncode,
}: {
  id: string;
  onEncode?: (input: VibeEncodingInput) => void;
}) {
  const view = useMediaQuery(id, mediaApi.inspectVibeAsset);
  const action = useVibeAction();
  const latest = useRef(onEncode);
  useLayoutEffect(() => {
    latest.current = onEncode;
  }, [onEncode]);
  if (view.loading) return <output className="vibe-status">正在读取编码信息…</output>;
  if (view.error)
    return <Notice actions={<Button onClick={view.retry}>重试</Button>}>{view.error}</Notice>;
  if (!view.value) return null;
  return (
    <>
      <dl className="vibe-identity">
        <div>
          <dt>模型</dt>
          <dd>{view.value.modelKey ?? "未记录"}</dd>
        </div>
        <div>
          <dt>信息提取量</dt>
          <dd>{view.value.informationExtracted ?? "未记录"}</dd>
        </div>
        {!view.value.hasSourceImage && (
          <div>
            <dt>原图</dt>
            <dd>未保留，无法调整编码参数</dd>
          </div>
        )}
        {view.value.hasSourceImage && view.value.sourceDocument && (
          <div>
            <dt>原图</dt>
            <dd>保存在文档中</dd>
          </div>
        )}
      </dl>
      {view.value.parameterKey && (
        <details>
          <summary>编码详情</summary>
          <code className="vibe-cache-key">{view.value.parameterKey}</code>
        </details>
      )}
      {action.error && <Notice>{action.error}</Notice>}
      {onEncode && view.value.canReencode && (
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
