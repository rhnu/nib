import { SafetyImage } from "@/features/media/safety-image";
import { t, useTranslation } from "@/shared/i18n";
import { useLayoutEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Expand, ImageOff } from "lucide-react";
import type { JobSummary, ResultSummary } from "@/bindings/generation";
import { Button, IconButton, Notice } from "@/shared/ui";
import { useMediaContent } from "@/features/media/use-media-content";
import { useFeedback } from "../jobs/feedback-context";
import { jobFeedbackText, type FeedbackSample } from "../jobs/feedback-state";
import { ResultCanvas, type ResultCanvasProps } from "./result-gallery";
import { errorMessage } from "@/shared/host/error";
import { resultsApi } from "./api";
import { ImageContextActions } from "@/features/media/image-context-actions";

export function PreviewImage({ sample }: { sample: FeedbackSample }) {
  useTranslation();

  const [frame, setFrame] = useState<{ bytes: FeedbackSample["bytes"]; url: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!sample.bytes) return;
    const url = URL.createObjectURL(new Blob([sample.bytes], { type: sample.mimeType }));
    // The object URL belongs to this committed frame, including a retained final preview.
    // oxlint-disable-next-line react/set-state-in-effect
    setFrame({ bytes: sample.bytes, url });
    return () => URL.revokeObjectURL(url);
  }, [sample.bytes, sample.mimeType]);
  const url = frame?.url ?? null;
  return url && url !== failed ? (
    <SafetyImage
      assetId={null}
      className="generation-live-image"
      src={url}
      alt={t("generation.samplePreview", { value0: sample.sampleIndex + 1 })}
      onError={() => setFailed(url)}
    />
  ) : null;
}

function SampleCell({
  job,
  index,
  result,
  sample,
  onSelect,
}: {
  job: JobSummary;
  index: number;
  result?: ResultSummary;
  sample?: FeedbackSample;
  onSelect: (result: ResultSummary) => void;
}) {
  useTranslation();

  const image = useMediaContent(
    result?.assetId ?? null,
    result?.mimeType ?? "image/png",
    result?.available ?? false,
  );
  const [decodedUrl, setDecodedUrl] = useState<string | null>(null);
  const decoded = Boolean(image.url && !image.error && decodedUrl === image.url);
  const { releasePreview } = useFeedback();
  return (
    <section
      className="request-sample"
      aria-label={t("generation.sampleNumber", { value0: index + 1 })}
    >
      {!decoded && sample?.bytes && <PreviewImage sample={sample} />}
      {image.url && result && (
        <ImageContextActions
          id={result.assetId}
          mimeType={result.mimeType}
          available={result.available}
        >
          <SafetyImage
            assetId={result.assetId}
            className="generation-live-image"
            src={image.url}
            alt={t("generation.sampleNumber", { value0: index + 1 })}
            style={{ opacity: decoded ? 1 : 0 }}
            onError={image.failed}
            onLoad={() => {
              setDecodedUrl(image.url);
              releasePreview(job.id, index);
            }}
          />
        </ImageContextActions>
      )}
      {!decoded && !sample?.bytes && (
        <output className="request-sample-status">
          <ImageOff size={22} />
          {image.error ?? jobFeedbackText(job, sample ? [sample] : [])}
        </output>
      )}
      {image.error && (
        <Button className="sample-retry" onClick={image.retry}>
          {t("generation.retryLoad")}
        </Button>
      )}
      <span className="request-sample-number">{index + 1}</span>
      {result && (
        <div className="image-overlay image-overlay-top">
          <IconButton
            label={t("generation.viewSample", { value0: index + 1 })}
            onClick={() => onSelect(result)}
          >
            <Expand size={17} />
          </IconButton>
        </div>
      )}
    </section>
  );
}

/** A request always owns the same sample cells while waiting, previewing and displaying saved images. */
export function RequestCanvas({
  job,
  onSelect,
  canvas,
}: {
  job: JobSummary;
  onSelect: (result: ResultSummary) => void;
  canvas: Omit<ResultCanvasProps, "result" | "onOpen"> & {
    onOpen: (result: ResultSummary) => void;
  };
}) {
  useTranslation();

  const { feedback, releasePreview } = useFeedback();
  const query = useQuery({
    queryKey: ["results", "job", job.id, job.status],
    placeholderData: (previous) => previous,
    queryFn: () => resultsApi.results({ kind: "image", jobId: job.id, before: null, limit: 200 }),
    enabled: job.status !== "queued",
    refetchInterval: job.status === "running" ? 2000 : false,
  });
  const results = query.data?.items ?? [];
  const samples = feedback[job.id] ?? [];
  const count =
    job.operation.kind === "generation" ? job.operation.sampleCount : Math.max(1, results.length);
  const first = results.find((result) => result.sampleIndex === 0);
  const preview = samples.find((sample) => sample.sampleIndex === 0);
  return (
    <div className="request-view">
      {query.error && (
        <Notice
          actions={
            <Button onClick={() => void query.refetch()}>{t("generation.retryLoad")}</Button>
          }
        >
          {errorMessage(query.error)}
        </Notice>
      )}
      {count === 1 && first ? (
        <ResultCanvas
          key={first.id}
          {...canvas}
          result={first}
          onOpen={() => canvas.onOpen(first)}
          fallback={preview?.bytes ? <PreviewImage sample={preview} /> : undefined}
          onImageLoaded={() => releasePreview(job.id, 0)}
        />
      ) : (
        <div
          className="request-grid"
          style={{
            gridTemplateColumns: `repeat(${count <= 1 ? 1 : count <= 4 ? 2 : 3}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: count }, (_, index) => (
            <SampleCell
              key={`${job.id}:${index}`}
              job={job}
              index={index}
              sample={samples.find((sample) => sample.sampleIndex === index)}
              result={results.find((result) => result.sampleIndex === index)}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
      {job.error && <Notice>{errorMessage(job.error)}</Notice>}
    </div>
  );
}
