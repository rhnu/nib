import {
  ActionsMenu,
  Button,
  ContextActions,
  IconButton,
  notify,
  Row,
  Input,
  Col,
} from "@/shared/ui";

import { SafetyImage } from "@/features/media/safety-image";
import { t, useTranslation } from "@/shared/i18n";
import { useState, type ReactNode } from "react";
import {
  Copy,
  Download,
  Focus,
  ImageOff,
  Info,
  Minus,
  Plus,
  ArrowDownToLine,
  RefreshCw,
} from "lucide-react";
import type { Draft } from "@/bindings/workbench";
import type { ResultSummary } from "@/bindings/generation";

import {
  ImageContextActions,
  useImageContextActions,
} from "@/features/media/image-context-actions";
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
    <ImageContextActions
      id={result.assetId}
      mimeType={result.mimeType}
      available={result.available}
      filename={resultFilename(result)}
    >
      <div className="generation-result-image relative min-w-0">
        <Button
          className={
            "generation-result-open [&.selected]:border-accent w-full p-0 flex flex-col gap-0 whitespace-normal overflow-hidden items-stretch rounded-control" +
            (selected ? " selected" : "")
          }
          aria-pressed={selected}
          aria-label={
            result.seed === null
              ? t("generation.viewImage")
              : t("generation.viewImageSeedPrefix") + result.seed
          }
          onClick={onSelect}
        >
          <Row
            gap={0}
            align="stretch"
            as="span"
            className="generation-result-preview [&_>_span]:flex-col [&_>_span]:gap-space-2 [&_img]:object-cover [&_>_span]:flex [&_>_span]:items-center [&_img]:w-full [&_img]:h-full [&_img]:min-h-0 w-full h-[82px] min-h-0 overflow-hidden flex items-center justify-center bg-background"
          >
            {!result.available ? (
              <ImageOff size={22} />
            ) : image.error ? (
              <span>{t("generation.loadFailed")}</span>
            ) : image.url ? (
              <SafetyImage
                assetId={result.assetId}
                src={image.url}
                alt=""
                loading="lazy"
                onError={image.failed}
              />
            ) : (
              <span>{t("generation.loading")}</span>
            )}
          </Row>
        </Button>
        {image.error && (
          <Row
            gap={0}
            className="image-overlay [&_.icon-button]:w-[30px] [&_.icon-button]:h-[30px] [&_.icon-button]:min-h-[30px] [&_.icon-button]:[flex:0_0_30px] [&_.icon-button]:inline-flex [&_.icon-button]:items-center [&_.icon-button]:justify-center [&_.icon-button]:text-inherit [&_.icon-button]:border-0 [&_.icon-button]:bg-transparent [&_.icon-button]:rounded-control [&_.icon-button]:no-underline [&_.generation-image-actions]:contents absolute z-[2] flex items-center gap-[2px] p-[3px] border border-line rounded-control bg-[color-mix(in_srgb,_var(--surface)_92%,_transparent)] [box-shadow:0_2px_12px_#0003] image-overlay-top-right"
          >
            <IconButton label={t("media.retryRead")} onClick={image.retry}>
              <RefreshCw size={14} aria-hidden />
            </IconButton>
          </Row>
        )}
      </div>
    </ImageContextActions>
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
  const [decodedUrl, setDecodedUrl] = useState<string | null>(null);
  const decoded = Boolean(image.url && !image.error && decodedUrl === image.url);
  const canZoom = Boolean(image.url && !image.error);
  const contextActions = useImageContextActions({
    id: result.assetId,
    mimeType: result.mimeType,
    available: result.available,
    filename: resultFilename(result),
    onImageOperation,
    onRestore,
    canMaxEnhance,
    canInpaint,
    extraItems: [{ separator: true }, { label: t("generation.parametersSources"), action: onOpen }],
  });

  const copySeed = async () => {
    if (result.seed === null) return;
    try {
      await navigator.clipboard.writeText(String(result.seed));
      notify(() => t("generation.seedCopied"), "copy-seed");
    } catch {
      notify(() => t("generation.seedCopyFailed"), "copy-seed", true);
    }
  };

  return (
    <>
      <ContextActions items={contextActions.items}>
        <Row
          gap={0}
          align="stretch"
          as="section"
          className="image-viewer relative flex flex-1 min-h-0 min-w-0 overflow-hidden [&_>_.generation-canvas]:min-h-0"
          aria-label={t("generation.imageViewer")}
        >
          <Row
            gap={0}
            className="image-overlay [&_.icon-button]:w-[30px] [&_.icon-button]:h-[30px] [&_.icon-button]:min-h-[30px] [&_.icon-button]:[flex:0_0_30px] [&_.icon-button]:inline-flex [&_.icon-button]:items-center [&_.icon-button]:justify-center [&_.icon-button]:text-inherit [&_.icon-button]:border-0 [&_.icon-button]:bg-transparent [&_.icon-button]:rounded-control [&_.icon-button]:no-underline [&_.generation-image-actions]:contents absolute z-[2] flex items-center gap-[2px] p-[3px] border border-line rounded-control bg-[color-mix(in_srgb,_var(--surface)_92%,_transparent)] [box-shadow:0_2px_12px_#0003] image-overlay-top left-[50%] top-[10px] [transform:translateX(-50%)] max-w-[calc(100%_-_16px)] whitespace-nowrap overflow-x-auto"
            role="toolbar"
            aria-label={t("generation.imageActions")}
          >
            {leadingTools}
            <ActionsMenu label={t("generation.imageActions")} items={contextActions.items} />
            <ImageResultActions
              assetId={result.assetId}
              available={result.available}
              onRestore={onRestore}
              onImageOperation={onImageOperation}
              canMaxEnhance={canMaxEnhance}
              canInpaint={canInpaint}
            />
            <span className="image-tool-divider h-[18px] border-l border-line my-0 mx-[3px]" />
            <IconButton label={t("generation.parametersSources")} onClick={onOpen}>
              <Info size={17} />
            </IconButton>
            <ActionsMenu
              label={t("media.saveImage")}
              icon={<Download size={17} aria-hidden />}
              disabled={contextActions.imageExport.disabled}
              items={contextActions.imageExport.saveItems}
            />
          </Row>
          <div
            className={
              "generation-canvas [&_p]:m-0 flex items-center justify-center flex-1 min-h-[180px] min-w-0 overflow-hidden p-space-5 [&.generation-canvas-viewer]:block [&.generation-canvas-viewer]:overflow-auto [&.generation-canvas-viewer]:p-0" +
              (canZoom ? " generation-canvas-viewer" : "")
            }
          >
            {!result.available ? (
              <Col
                gap={0}
                align="stretch"
                className="generation-canvas-status flex flex-col items-center gap-space-3 text-muted text-label"
              >
                <ImageOff size={28} />
                <p>{t("generation.imageFileIncomplete")}</p>
              </Col>
            ) : image.error ? (
              <Col
                gap={0}
                align="stretch"
                className="generation-canvas-status flex flex-col items-center gap-space-3 text-label generation-danger text-danger"
              >
                <p>{image.error}</p>
                <Button onClick={image.retry}>{t("generation.retryLoad")}</Button>
              </Col>
            ) : image.url ? (
              <Row
                gap={0}
                align="stretch"
                className="generation-canvas-image-stage [&_>_img]:object-contain [&_>_.generation-live-image]:absolute [&_>_.generation-live-image]:inset-0 [&_>_img]:block [&_>_img]:min-h-0 [&_>_img]:min-w-0 flex items-center justify-center min-w-0 min-h-0 relative"
                style={{
                  width: Math.max(1, zoom) * 100 + "%",
                  height: Math.max(1, zoom) * 100 + "%",
                }}
              >
                {!decoded && fallback}
                <SafetyImage
                  assetId={result.assetId}
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
              </Row>
            ) : (
              (fallback ?? (
                <output className="generation-muted text-muted">
                  {t("generation.loadingImages")}
                </output>
              ))
            )}
          </div>
          {result.operation.kind === "generation" && (
            <Row
              gap={0}
              className="image-overlay [&_.icon-button]:w-[30px] [&_.icon-button]:h-[30px] [&_.icon-button]:min-h-[30px] [&_.icon-button]:[flex:0_0_30px] [&_.icon-button]:inline-flex [&_.icon-button]:items-center [&_.icon-button]:justify-center [&_.icon-button]:text-inherit [&_.icon-button]:border-0 [&_.icon-button]:bg-transparent [&_.icon-button]:rounded-control [&_.icon-button]:no-underline [&_.generation-image-actions]:contents absolute z-[2] flex items-center gap-[2px] p-[3px] border border-line rounded-control bg-[color-mix(in_srgb,_var(--surface)_92%,_transparent)] [box-shadow:0_2px_12px_#0003] image-overlay-bottom-left left-[10px] bottom-[10px]"
            >
              <Input
                autoComplete="off"
                className="image-seed w-[108px] min-h-[28px] py-[3px] px-space-2 [font:11px_var(--font-mono)]"
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
            </Row>
          )}
          <Row
            gap={0}
            className="image-overlay [&_.icon-button]:w-[30px] [&_.icon-button]:h-[30px] [&_.icon-button]:min-h-[30px] [&_.icon-button]:[flex:0_0_30px] [&_.icon-button]:inline-flex [&_.icon-button]:items-center [&_.icon-button]:justify-center [&_.icon-button]:text-inherit [&_.icon-button]:border-0 [&_.icon-button]:bg-transparent [&_.icon-button]:rounded-control [&_.icon-button]:no-underline [&_.generation-image-actions]:contents absolute z-[2] flex items-center gap-[2px] p-[3px] border border-line rounded-control bg-[color-mix(in_srgb,_var(--surface)_92%,_transparent)] [box-shadow:0_2px_12px_#0003] image-overlay-bottom-right right-[10px] bottom-[10px]"
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
          </Row>
        </Row>
      </ContextActions>
      {contextActions.dialogs}
    </>
  );
}
