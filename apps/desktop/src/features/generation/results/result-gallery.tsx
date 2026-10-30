import { t, useTranslation } from "@/shared/i18n";
import { useEffect, useState, type ReactNode } from "react";
import { Copy, Download, Focus, ImageOff, Info, Minus, Plus, ArrowDownToLine } from "lucide-react";
import type { Draft } from "@/bindings/workbench";
import type { ResultSummary } from "@/bindings/generation";
import { Button, IconButton } from "@/shared/ui";
import { useMediaContent } from "@/features/media/use-media-content";
import { resultFilename } from "./result-file";
import { ImageResultActions } from "./image-result-actions";
import type { ImageOperationAction } from "@/features/inputs/image-operation";

export function ResultTile({
  result,
  selected,
  onSelect,
}: {
  result: ResultSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  useTranslation();

  const image = useMediaContent(result.assetId, result.mimeType, result.available, "thumbnail");
  return (
    <Button
      className={"generation-result-open" + (selected ? " selected" : "")}
      aria-pressed={selected}
      aria-label={
        result.seed === null
          ? t("generation.viewImage")
          : t("generation.viewImageSeedPrefix") + result.seed
      }
      onClick={onSelect}
    >
      <span className="generation-result-preview">
        {!result.available ? (
          <ImageOff size={22} />
        ) : image.error ? (
          <span>{t("generation.loadFailed")}</span>
        ) : image.url ? (
          <img src={image.url} alt="" loading="lazy" onError={image.failed} />
        ) : (
          <span>{t("generation.loading")}</span>
        )}
      </span>
    </Button>
  );
}

export type ResultCanvasProps = {
  result: ResultSummary;
  onOpen: () => void;
  onUseSeed?: (seed: number) => void;
  onRestore: (draft: Draft) => void;
  onImageOperation: (id: string, kind: ImageOperationAction) => void;
  canMaxEnhance: boolean;
  canInpaint: boolean;
  leadingTools?: ReactNode;
  fallback?: ReactNode;
  onImageLoaded?: () => void;
};

/** Image content owns the surface; all operations are compact floating icon controls. */
export function ResultCanvas({
  result,
  onOpen,
  onUseSeed,
  onRestore,
  onImageOperation,
  canMaxEnhance,
  canInpaint,
  leadingTools,
  fallback,
  onImageLoaded,
}: ResultCanvasProps) {
  useTranslation();

  const image = useMediaContent(result.assetId, result.mimeType, result.available);
  const [zoom, setZoom] = useState(1);
  const [copyState, setCopyState] = useState<"copied" | "failed" | null>(null);
  useEffect(() => {
    if (!copyState) return;
    const timer = setTimeout(() => setCopyState(null), 2500);
    return () => clearTimeout(timer);
  }, [copyState]);
  const [decodedUrl, setDecodedUrl] = useState<string | null>(null);
  const decoded = Boolean(image.url && !image.error && decodedUrl === image.url);
  const canZoom = Boolean(image.url && !image.error);

  const copySeed = async () => {
    if (result.seed === null) return;
    try {
      await navigator.clipboard.writeText(String(result.seed));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <section className="image-viewer" aria-label={t("generation.imageViewer")}>
      <div
        className="image-overlay image-overlay-top"
        role="toolbar"
        aria-label={t("generation.imageActions")}
      >
        {leadingTools}
        <ImageResultActions
          assetId={result.assetId}
          available={result.available}
          onRestore={onRestore}
          onImageOperation={onImageOperation}
          canMaxEnhance={canMaxEnhance}
          canInpaint={canInpaint}
        />
        <span className="image-tool-divider" />
        <IconButton label={t("generation.parametersSources")} onClick={onOpen}>
          <Info size={17} />
        </IconButton>
        {image.url && (
          <a
            className="image-icon-link"
            href={image.url}
            download={resultFilename(result)}
            aria-label={t("generation.saveOriginal")}
            title={t("generation.saveOriginal")}
          >
            <Download size={17} />
          </a>
        )}
      </div>
      <div className={"generation-canvas" + (canZoom ? " generation-canvas-viewer" : "")}>
        {!result.available ? (
          <div className="generation-canvas-status">
            <ImageOff size={28} />
            <p>{t("generation.imageFileIncomplete")}</p>
          </div>
        ) : image.error ? (
          <div className="generation-canvas-status generation-danger">
            <p>{image.error}</p>
            <Button onClick={image.retry}>{t("generation.retryLoad")}</Button>
          </div>
        ) : image.url ? (
          <div
            className="generation-canvas-image-stage"
            style={{ width: Math.max(1, zoom) * 100 + "%", height: Math.max(1, zoom) * 100 + "%" }}
          >
            {!decoded && fallback}
            <img
              style={{
                width: Math.min(1, zoom) * 100 + "%",
                height: Math.min(1, zoom) * 100 + "%",
                visibility: !decoded && fallback ? "hidden" : undefined,
              }}
              src={image.url}
              alt={
                result.seed === null
                  ? t("generation.generatedImage")
                  : t("generation.generatedImageSeedPrefix") + result.seed
              }
              onError={image.failed}
              onLoad={() => {
                setDecodedUrl(image.url);
                onImageLoaded?.();
              }}
            />
          </div>
        ) : (
          (fallback ?? (
            <output className="generation-muted">{t("generation.loadingImages")}</output>
          ))
        )}
      </div>
      {result.operation.kind === "generation" && (
        <div className="image-overlay image-overlay-bottom-left">
          <input
            className="image-seed"
            aria-label={t("generation.sampleSeed")}
            readOnly
            value={result.seed ?? t("generation.seedUnknown")}
          />
          <IconButton
            label={t("generation.useSeed")}
            disabled={result.seed === null || !onUseSeed}
            onClick={() => result.seed !== null && onUseSeed?.(result.seed)}
          >
            <ArrowDownToLine size={16} />
          </IconButton>
          <IconButton
            label={t("generation.copySeed")}
            disabled={result.seed === null}
            onClick={() => void copySeed()}
          >
            <Copy size={16} />
          </IconButton>
          {copyState && (
            <output className="image-copy-status">
              {copyState === "copied" ? t("generation.seedCopied") : t("generation.seedCopyFailed")}
            </output>
          )}
        </div>
      )}
      <div
        className="image-overlay image-overlay-bottom-right"
        role="toolbar"
        aria-label={t("generation.zoom")}
      >
        <IconButton
          label={t("generation.zoomOut")}
          disabled={!canZoom || zoom <= 0.25}
          onClick={() => setZoom((value) => Math.max(0.25, value - 0.25))}
        >
          <Minus size={16} />
        </IconButton>
        <IconButton
          label={t("generation.fitCanvas")}
          disabled={!canZoom}
          onClick={() => setZoom(1)}
        >
          <Focus size={16} />
        </IconButton>
        <IconButton
          label={t("generation.zoomIn")}
          disabled={!canZoom || zoom >= 4}
          onClick={() => setZoom((value) => Math.min(4, value + 0.25))}
        >
          <Plus size={16} />
        </IconButton>
      </div>
    </section>
  );
}
