import { useEffect, useState } from "react";
import { Image, ImageOff } from "lucide-react";
import type { GenerationResult, JobRecord } from "../../bindings/generation";
import { Button } from "../../shared/ui";
import { useGeneration } from "./generation-context";
import { jobFeedbackText, type FeedbackSample } from "./feedback-state";
import { submissionLabel } from "./operation";
import { JobCostSummary } from "./JobCostSummary";
import { useResultImage } from "./use-result-image";

function PreviewImage({ sample }: { sample: FeedbackSample }) {
  const [image, setImage] = useState<{ bytes: FeedbackSample["bytes"]; url: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!sample.bytes) return;
    const url = URL.createObjectURL(new Blob([sample.bytes], { type: sample.mimeType }));
    // The URL belongs to a committed frame; creating it during render leaks discarded frames.
    // oxlint-disable-next-line react/set-state-in-effect
    setImage({ bytes: sample.bytes, url });
    return () => URL.revokeObjectURL(url);
  }, [sample.bytes, sample.mimeType]);
  const url = image?.bytes === sample.bytes ? image.url : null;
  return url && failed !== url ? (
    <img
      className="generation-live-image"
      src={url}
      alt={`临时预览，样本 ${sample.sampleIndex + 1}，步骤 ${sample.stepIndex}`}
      onError={() => setFailed(url)}
    />
  ) : (
    <div className="generation-canvas-status">
      <ImageOff size={28} />
      <p>{failed === url && url ? "此预览无法显示，等待下一帧" : "等待预览"}</p>
    </div>
  );
}

function SavedLiveImage({ result }: { result: GenerationResult }) {
  const image = useResultImage(result.id, result.mimeType, result.available);
  if (!result.available) return <p className="generation-muted">结果媒体缺失或不完整</p>;
  if (image.error)
    return (
      <div className="generation-canvas-status generation-danger">
        <p>{image.error}</p>
        <Button onClick={image.retry}>重试读取</Button>
      </div>
    );
  return image.url ? (
    <img
      className="generation-live-image"
      src={image.url}
      alt={`已保存结果，样本 ${result.sampleIndex + 1}`}
      onError={image.failed}
    />
  ) : (
    <output className="generation-muted">正在读取已保存结果…</output>
  );
}

export function LivePreview({
  jobId,
  sampleIndex,
  onSelect,
  onOpenResult,
}: {
  jobId: string | null;
  sampleIndex: number;
  onSelect: (jobId: string, sampleIndex: number) => void;
  onOpenResult: (result: GenerationResult) => void;
}) {
  const { jobs, results, feedback } = useGeneration();
  const activeJobs =
    jobs?.filter((job) => job.status === "queued" || job.status === "running") ?? [];
  const job =
    jobs?.find((value) => value.id === jobId) ?? (jobId === null ? activeJobs[0] : undefined);
  const samples = job ? (feedback[job.id] ?? []) : [];
  const sample = samples.find((value) => value.sampleIndex === sampleIndex);
  const jobResults = results?.filter((value) => value.jobId === job?.id) ?? [];
  const saved = jobResults.find((value) => value.sampleIndex === sampleIndex);
  const count =
    job?.submission.kind === "generation"
      ? job.submission.resolved.settings.nSamples
      : Math.max(
          1,
          ...samples.map((value) => value.sampleIndex + 1),
          ...jobResults.map((value) => value.sampleIndex + 1),
        );
  // Pin the initial task so a later request never inherits another task's cursor.
  useEffect(() => {
    if (job && jobId === null) onSelect(job.id, 0);
  }, [job, jobId, onSelect]);
  return (
    <section className="generation-gallery" aria-label="任务执行预览">
      {job ? (
        <>
          <div className="generation-live-controls">
            <label>
              任务
              <select value={job.id} onChange={(event) => onSelect(event.target.value, 0)}>
                {[job, ...activeJobs.filter((value) => value.id !== job.id)].map((value) => (
                  <option key={value.id} value={value.id}>
                    {submissionLabel(value.submission)} ·{" "}
                    {new Date(value.submittedAt).toLocaleTimeString()} · {value.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <div className="button-group" aria-label="预览样本">
              {Array.from({ length: count }, (_, index) => (
                <Button
                  key={index}
                  className="quiet"
                  aria-pressed={sampleIndex === index}
                  onClick={() => onSelect(job.id, index)}
                >
                  样本 {index + 1}
                </Button>
              ))}
            </div>
          </div>
          <div className="generation-canvas-toolbar" aria-live="polite">
            <span>{jobFeedbackText(job, sample ? [sample] : [])}</span>
            {saved && (
              <Button className="quiet" onClick={() => onOpenResult(saved)}>
                查看已保存结果
              </Button>
            )}
          </div>
          <div className="generation-canvas generation-live-canvas">
            {saved?.kind === "image" && job.status === "completed" ? (
              <SavedLiveImage key={saved.id} result={saved} />
            ) : sample?.bytes ? (
              <PreviewImage key={`${job.id}:${sampleIndex}`} sample={sample} />
            ) : (
              <LiveEmpty
                job={job}
                saved={Boolean(saved)}
                finalReceived={sample?.finalReceived ?? false}
              />
            )}
          </div>
          {job.error && <p className="generation-live-error generation-danger">{job.error}</p>}
          <JobCostSummary job={job} />
        </>
      ) : (
        <div className="generation-canvas generation-canvas-empty">
          <Image size={32} />
          <p>当前没有执行中的任务</p>
        </div>
      )}
    </section>
  );
}

function LiveEmpty({
  job,
  saved,
  finalReceived,
}: {
  job: JobRecord;
  saved: boolean;
  finalReceived: boolean;
}) {
  const text = saved
    ? "结果已保存"
    : job.status === "queued"
      ? "等待执行"
      : job.status === "running"
        ? finalReceived
          ? "最终图已接收，等待任务完成与保存"
          : "等待预览或最终图返回"
        : job.status === "completed"
          ? "任务已完成，正在读取已保存结果"
          : "任务已结束";
  return (
    <div className="generation-canvas-status">
      <Image size={28} />
      <p>{text}</p>
    </div>
  );
}
