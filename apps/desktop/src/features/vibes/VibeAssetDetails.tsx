import type { VibeAssetInspection } from "../../bindings/media";
import { mediaApi } from "../media/api";
import { useMediaQuery } from "../media/useMediaQuery";
import { Button, Notice } from "../../shared/ui";

export function VibeAssetInformation({ inspection }: { inspection: VibeAssetInspection }) {
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
    </>
  );
}

export function VibeAssetDetails({ id }: { id: string }) {
  const view = useMediaQuery(["media", "vibe-inspection", id], id, mediaApi.inspectVibeAsset);
  if (view.loading) return <output className="vibe-status">正在读取编码信息…</output>;
  if (view.error)
    return <Notice actions={<Button onClick={view.retry}>重试</Button>}>{view.error}</Notice>;
  return view.value ? <VibeAssetInformation inspection={view.value} /> : null;
}
