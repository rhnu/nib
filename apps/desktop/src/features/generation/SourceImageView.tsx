import { Button } from "../../shared/ui";
import { AssetImage } from "../media/AssetImage";
import { useMediaAsset } from "../media/useMediaAsset";

export function SourceImageView({ id }: { id: string }) {
  const media = useMediaAsset(id);
  return (
    <div className="generation-source-view">
      {media.error ? (
        <div role="alert">
          {media.error}
          <Button onClick={media.retry}>重试读取</Button>
        </div>
      ) : media.asset ? (
        <>
          <div className="generation-canvas-metadata generation-muted">
            源图 · {media.asset.width} × {media.asset.height}
          </div>
          <AssetImage
            asset={media.asset}
            alt="当前操作的源图"
            className="generation-source-image"
          />
        </>
      ) : (
        <output>正在读取源图…</output>
      )}
    </div>
  );
}
