import { useEffect, useMemo, useState } from "react";
import type { MediaAsset } from "../../bindings/media";
import { errorMessage } from "../../shared/host/error";
import { Button, Notice } from "../../shared/ui";
import { mediaApi } from "./api";
import { imageUnavailableReason } from "./model";
import "./media.css";

/** Read retained bytes, and release their URL whenever the identity or attempt changes. */
export function useAssetImage(asset: MediaAsset) {
  const { id, mimeType, available, kind } = asset;
  const unavailable = imageUnavailableReason(asset);
  const [attempt, setAttempt] = useState(0);
  const source = useMemo(
    () => ({ id, mimeType, available, kind, attempt }),
    [id, mimeType, available, kind, attempt],
  );
  const [state, setState] = useState<{
    source: typeof source;
    url: string | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!available || kind !== "image") return;
    let active = true;
    let url: string | null = null;
    void mediaApi.content(id).then(
      (bytes) => {
        if (!active) return;
        url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
        setState({ source, url, error: null });
      },
      (cause: unknown) => {
        if (active) setState({ source, url: null, error: errorMessage(cause) });
      },
    );
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, mimeType, available, kind, source]);
  const current = state?.source === source ? state : null;
  return {
    url: unavailable ? null : (current?.url ?? null),
    error: unavailable ?? current?.error ?? null,
    loading: !unavailable && current === null,
    retry: () => setAttempt((value) => value + 1),
    failed: () =>
      setState({ source, url: null, error: "图片内容无法显示，请重试读取或重新导入。" }),
  };
}

export function AssetImage({
  asset,
  alt,
  className,
}: {
  asset: MediaAsset;
  alt: string;
  className?: string;
}) {
  const image = useAssetImage(asset);
  if (image.error)
    return (
      <Notice
        actions={
          asset.available && asset.kind === "image" ? (
            <Button onClick={image.retry}>重试读取</Button>
          ) : undefined
        }
      >
        {image.error}
      </Notice>
    );
  if (!image.url) return <output className="media-loading">正在读取图片…</output>;
  return (
    <img className={className ?? "media-image"} src={image.url} alt={alt} onError={image.failed} />
  );
}
