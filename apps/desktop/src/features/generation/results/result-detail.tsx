import { useMediaQuery } from "@/features/media/use-media-query";
import { resultsApi } from "./api";
import { useEffect, useRef, useState } from "react";
import { ArrowUpLeft, RotateCw } from "lucide-react";
import type { Draft } from "@/bindings/workbench";
import type { GenerationResult } from "@/bindings/generation";
import { Button, Modal, Notice } from "@/shared/ui";
import { errorMessage } from "@/shared/host/error";
import { ResultResubmitDialog } from "./result-resubmit-dialog";
import { SubmissionSummary } from "../submission/submission-summary";
import { useMediaContent } from "@/features/media/use-media-content";
import type { ImageOperationAction } from "@/features/inputs/image-operation";

function ResultDetailContent({
  result,
  onClose,
  onRestore,
}: {
  result: GenerationResult;
  onClose: () => void;
  onRestore: (draft: Draft) => void;
  onUseSeed?: (seed: number) => void;
  onImageOperation: (id: string, kind: ImageOperationAction) => void;
  canMaxEnhance: boolean;
  canInpaint: boolean;
}) {
  const isDirector = result.submission.kind === "director";
  const image = useMediaContent(result.assetId, result.mimeType, result.available);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [resubmitOpen, setResubmitOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const lock = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  async function restore() {
    if (lock.current) return;
    lock.current = true;
    setRestoring(true);
    setError(null);
    try {
      const draft = await resultsApi.restore(result.id);
      if (!active.current) return;
      onRestore(draft);
      onClose();
    } catch (cause) {
      if (active.current) setError(errorMessage(cause));
    } finally {
      lock.current = false;
      if (active.current) setRestoring(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={
        isDirector
          ? `导演工具结果 · 输出 ${result.sampleIndex + 1}`
          : `生成结果 · 样本 ${result.sampleIndex + 1}`
      }
      wide
    >
      <div className="generation-detail">
        <div className="generation-detail-image">
          {!result.available ? (
            <p className="generation-muted">媒体文件缺失，无法查看图像。</p>
          ) : image.error ? (
            <Notice actions={<Button onClick={image.retry}>重试读取</Button>}>{image.error}</Notice>
          ) : image.url ? (
            <img
              src={image.url}
              alt={
                result.seed === null
                  ? "生成结果，样本种子未记录"
                  : `生成结果，样本种子 ${result.seed}`
              }
              onError={image.failed}
            />
          ) : (
            <output>正在读取结果图像…</output>
          )}
        </div>
        <div className="generation-detail-info">
          <SubmissionSummary submission={result.submission} />
          {result.submission.kind === "generation" && (
            <p className="generation-muted">
              {result.seed === null
                ? "图片未记录样本种子；恢复时使用原提交种子，无法据此精确重现此样本。"
                : `样本种子：${result.seed}`}
            </p>
          )}
          <div className="generation-detail-actions">
            <Button
              onClick={() => {
                setConfirmRestore(true);
                setError(null);
              }}
              disabled={restoring || !result.available}
            >
              <ArrowUpLeft size={14} />
              {isDirector ? "恢复工具输入" : "恢复到当前创作"}
            </Button>
            <Button onClick={() => setResubmitOpen(true)} disabled={restoring || !result.available}>
              <RotateCw size={14} />
              {isDirector ? "再次处理" : "再次生成"}
            </Button>
          </div>
          {confirmRestore && (
            <fieldset className="generation-restore-confirm">
              <legend>{isDirector ? "替换工具输入？" : "替换当前创作？"}</legend>
              <p>
                {isDirector
                  ? "将恢复此结果使用的工具、源图和参数。"
                  : "当前提示词、配方与设置将替换为此结果保存的独立内容，并自动保存。此操作不会发起生成。"}
              </p>
              <div className="generation-dialog-actions">
                <Button disabled={restoring} onClick={() => setConfirmRestore(false)}>
                  {isDirector ? "保留工具输入" : "保留当前创作"}
                </Button>
                <Button className="primary" disabled={restoring} onClick={() => void restore()}>
                  {restoring ? "正在恢复…" : isDirector ? "恢复工具输入" : "替换当前创作"}
                </Button>
              </div>
            </fieldset>
          )}
          {error && <Notice>{error}</Notice>}
        </div>
      </div>
      {resubmitOpen && (
        <ResultResubmitDialog result={result} onClose={() => setResubmitOpen(false)} />
      )}
    </Modal>
  );
}

/** Frozen parameters are read only when the user opens a result. */
export function ResultDetail(
  props: Omit<Parameters<typeof ResultDetailContent>[0], "result"> & {
    result: Pick<GenerationResult, "id">;
  },
) {
  const detail = useMediaQuery(
    ["results", "detail", props.result.id],
    props.result.id,
    resultsApi.get,
  );
  if (detail.value) return <ResultDetailContent {...props} result={detail.value} />;
  return (
    <Modal open onClose={props.onClose} title="生成结果">
      <div className="generation-dialog-body">
        {detail.error ? (
          <Notice actions={<Button onClick={detail.retry}>重试读取</Button>}>{detail.error}</Notice>
        ) : (
          <output>正在读取结果详情…</output>
        )}
      </div>
    </Modal>
  );
}
