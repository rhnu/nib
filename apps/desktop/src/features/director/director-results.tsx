import { t, useTranslation } from "@/shared/i18n";
import { useMediaQuery } from "@/features/media/use-media-query";
import { resultsApi } from "@/features/generation/results/api";
import { summarizeResult } from "@/features/generation/jobs/summary";
import { useJobData } from "@/features/generation/jobs/job-context";
import { useState } from "react";
import { Columns2 } from "lucide-react";
import type { ResultSummary } from "@/bindings/generation";
import type { DirectorToolKind, Draft } from "@/bindings/workbench";
import { ActionsMenu, Button, IconButton, Notice } from "@/shared/ui";
import { AssetImage } from "@/features/media/asset-image";
import { useMediaAsset } from "@/features/media/use-media-asset";
import { ResultCanvas } from "@/features/generation/results/result-gallery";
import { ResultDetail } from "@/features/generation/results/result-detail";
import { useMediaContent } from "@/features/media/use-media-content";
import type { ImageOperationAction } from "@/features/inputs/image-operation";
import { imageName } from "@/features/media/model";
import { directorOutputLabel, directorToolLabels } from "./model";
import { ImageContextActions } from "@/features/media/image-context-actions";

function SourceFrame({ id, title }: { id: string | null; title: string }) {
  useTranslation();

  const media = useMediaAsset(id);
  return (
    <section className="director-image-frame">
      <header>
        {title}
        {media.asset
          ? ` · ${imageName(media.asset)} · ${media.asset.width} × ${media.asset.height}`
          : ""}
      </header>
      <div className="director-image-surface">
        {media.error ? (
          <Notice actions={<Button onClick={media.retry}>{t("director.retryLoad")}</Button>}>
            {media.error}
          </Notice>
        ) : media.asset ? (
          <AssetImage asset={media.asset} alt={title} className="director-image" />
        ) : (
          <p className="muted">{id ? t("director.loadingInput") : t("director.noInput")}</p>
        )}
      </div>
    </section>
  );
}

function OutputThumbnail({
  result,
  selected,
  onSelect,
}: {
  result: ResultSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  useTranslation();

  const image = useMediaContent(result.assetId, "image/png", result.available, "thumbnail");
  const label = directorOutputLabel(result);
  return (
    <ImageContextActions
      id={result.assetId}
      mimeType={result.mimeType}
      available={result.available}
    >
      <Button
        className={`director-thumbnail ${selected ? "is-selected" : ""}`}
        aria-pressed={selected}
        aria-label={label}
        title={label}
        onClick={onSelect}
      >
        {image.url ? (
          <img src={image.url} alt="" onError={image.failed} />
        ) : (
          <span>
            {!result.available
              ? t("director.fileUnavailable")
              : image.error
                ? t("director.loadFailed")
                : t("director.loading")}
          </span>
        )}
        <span>{label}</span>
      </Button>
    </ImageContextActions>
  );
}

export function DirectorResults({
  tool,
  tools,
  sourceId,
  selectedId,
  onSelect,
  onContinue,
  onUseImage,
  onReference,
  onEncodeVibe,
  onRestore,
  canMaxEnhance = false,
  canInpaint = false,
  canUsePreciseReference = false,
  canUseVibeReference = false,
}: {
  tool: DirectorToolKind;
  tools: DirectorToolKind[];
  sourceId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onContinue: (id: string, tool: DirectorToolKind) => void;
  onUseImage: (id: string, kind: ImageOperationAction) => void;
  onReference: (id: string, kind: "precise" | "vibe") => void;
  onEncodeVibe: (id: string) => void;
  onRestore: (draft: Draft) => void;
  canMaxEnhance?: boolean;
  canInpaint?: boolean;
  canUsePreciseReference?: boolean;
  canUseVibeReference?: boolean;
}) {
  useTranslation();

  const generation = useJobData();
  const outputs =
    generation.results?.filter(
      (result) =>
        result.kind === "image" &&
        result.operation.kind === "director" &&
        result.operation.tool === tool,
    ) ?? [];
  const retained = useMediaQuery(
    ["results", "detail", selectedId],
    selectedId &&
      generation.results !== null &&
      !generation.results.some((item) => item.id === selectedId)
      ? selectedId
      : null,
    resultsApi.get,
  );
  const retainedSummary = retained.value ? summarizeResult(retained.value) : null;
  const pinned =
    retainedSummary?.operation.kind === "director" && retainedSummary.operation.tool === tool
      ? retainedSummary
      : null;
  const selected =
    outputs.find((result) => result.id === selectedId) ??
    pinned ??
    (retained.loading ? null : outputs[0]) ??
    null;
  const submittedSource =
    selected?.operation.kind === "director" ? selected.operation.assetId : sourceId;
  const [visibleCount, setVisibleCount] = useState(12);
  const [compare, setCompare] = useState(true);
  const [detail, setDetail] = useState<ResultSummary | null>(null);
  const available = selected?.available ?? false;
  return (
    <section className="director-results" aria-label={t("director.inputOutput")}>
      {retained.error && (
        <Notice
          actions={<Button onClick={retained.retry}>{t("director.retrySelectedOutput")}</Button>}
        >
          {retained.error}
        </Notice>
      )}
      {generation.queryError && (
        <Notice
          actions={
            <Button onClick={() => void generation.refresh()}>{t("director.retryQuery")}</Button>
          }
        >
          {generation.queryError}
        </Notice>
      )}
      <div className={`director-comparison ${compare && selected ? "is-comparing" : ""}`}>
        {(!selected || compare) && (
          <SourceFrame
            id={submittedSource}
            title={selected ? t("director.submittedSource") : t("director.input")}
          />
        )}
        {selected && (
          <ResultCanvas
            key={selected.id}
            result={selected}
            onOpen={() => setDetail(selected)}
            onRestore={onRestore}
            onImageOperation={onUseImage}
            canMaxEnhance={canMaxEnhance}
            canInpaint={canInpaint}
            leadingTools={
              <>
                <IconButton
                  label={t("director.compare")}
                  aria-pressed={compare}
                  onClick={() => setCompare((value) => !value)}
                >
                  <Columns2 size={17} />
                </IconButton>
                <ActionsMenu
                  label={t("director.continueWithOutput")}
                  items={[
                    ...tools.map((target) => ({
                      label: t("director.continueTool", { value0: directorToolLabels[target] }),
                      disabled: !available,
                      action: () => onContinue(selected.assetId, target),
                    })),
                    {
                      label: t("director.useAsPreciseReference"),
                      disabled: !available || !canUsePreciseReference,
                      action: () => onReference(selected.assetId, "precise"),
                    },
                    {
                      label: t("director.useAsVibeReference"),
                      disabled: !available || !canUseVibeReference,
                      action: () => onReference(selected.assetId, "vibe"),
                    },
                    {
                      label: t("director.encodeVibe"),
                      disabled: !available,
                      action: () => onEncodeVibe(selected.assetId),
                    },
                  ]}
                />
              </>
            }
          />
        )}
      </div>
      <div className="director-output-strip" aria-label={t("director.allOutputs")}>
        {generation.results === null ? (
          <output className="muted">{t("director.loadingResults")}</output>
        ) : (
          outputs
            .slice(0, visibleCount)
            .map((result) => (
              <OutputThumbnail
                key={result.id}
                result={result}
                selected={selected?.id === result.id}
                onSelect={() => onSelect(result.id)}
              />
            ))
        )}
        {outputs.length > visibleCount && (
          <Button onClick={() => setVisibleCount((count) => count + 12)}>
            {t("director.moreOutputs")}
          </Button>
        )}
        {generation.hasMoreResults && (
          <Button
            disabled={generation.loadingMoreResults}
            onClick={() => void generation.loadMoreResults()}
          >
            {generation.loadingMoreResults ? t("director.loadingMore") : t("director.loadEarlier")}
          </Button>
        )}
      </div>
      {detail && (
        <ResultDetail
          result={detail}
          onClose={() => setDetail(null)}
          onRestore={onRestore}
          onImageOperation={onUseImage}
          canMaxEnhance={canMaxEnhance}
          canInpaint={canInpaint}
        />
      )}
    </section>
  );
}
