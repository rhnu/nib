import { Button, IconButton, Notice, Row, Col, Grid } from "@/shared/ui";

import { SafetyImage } from "@/features/media/safety-image";
import { t, useTranslation } from "@/shared/i18n";
import { useLayoutEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Expand, ImageOff } from "lucide-react";
import type { JobSummary, ResultSummary } from "@/bindings/generation";

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
      className="generation-live-image w-full h-full min-w-0 min-h-0 object-contain"
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
      className="request-sample [&_>_img]:inset-0 [&_.image-overlay]:left-auto [&_.image-overlay]:right-[5px] [&_.image-overlay]:top-[5px] [&_.image-overlay]:[transform:none] [&_>_img]:absolute relative min-w-0 min-h-0 bg-background border border-line-subtle overflow-hidden"
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
            className="generation-live-image w-full h-full min-w-0 min-h-0 object-contain"
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
        <output className="request-sample-status flex flex-col items-center justify-center gap-[7px] h-full text-muted text-caption p-space-4 text-center">
          <ImageOff size={22} />
          {image.error ?? jobFeedbackText(job, sample ? [sample] : [])}
        </output>
      )}
      {image.error && (
        <Button className="sample-retry absolute bottom-[6px] right-[6px]" onClick={image.retry}>
          {t("generation.retryLoad")}
        </Button>
      )}
      <span className="request-sample-number absolute bottom-[5px] left-[5px] py-[2px] px-[5px] text-caption bg-panel text-muted">
        {index + 1}
      </span>
      {result && (
        <Row
          gap={0}
          className="image-overlay [&_.icon-button]:w-[30px] [&_.icon-button]:h-[30px] [&_.icon-button]:min-h-[30px] [&_.icon-button]:[flex:0_0_30px] [&_.icon-button]:inline-flex [&_.icon-button]:items-center [&_.icon-button]:justify-center [&_.icon-button]:text-inherit [&_.icon-button]:border-0 [&_.icon-button]:bg-transparent [&_.icon-button]:rounded-control [&_.icon-button]:no-underline [&_.generation-image-actions]:contents absolute z-[2] flex items-center gap-[2px] p-[3px] border border-line rounded-control bg-[color-mix(in_srgb,_var(--surface)_92%,_transparent)] [box-shadow:0_2px_12px_#0003] image-overlay-top left-[50%] top-[10px] [transform:translateX(-50%)] max-w-[calc(100%_-_16px)] whitespace-nowrap overflow-x-auto"
        >
          <IconButton
            label={t("generation.viewSample", { value0: index + 1 })}
            onClick={() => onSelect(result)}
          >
            <Expand size={17} />
          </IconButton>
        </Row>
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
    <Col gap={0} align="stretch" className="request-view flex flex-col flex-1 min-h-0 min-w-0">
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
        <Grid
          gap={0}
          align="stretch"
          columns={1}
          className="request-grid grid [grid-auto-rows:minmax(0,_1fr)] gap-space-2 p-space-2 flex-1 min-h-0"
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
        </Grid>
      )}
      {job.error && <Notice>{errorMessage(job.error)}</Notice>}
    </Col>
  );
}
