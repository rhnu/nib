import { useEffect, useRef, useState } from "react";
import { ArrowUpLeft, RotateCw } from "lucide-react";
import type { Draft } from "../../bindings/workbench";
import type { GenerationResult } from "../../bindings/generation";
import { Button, Modal, Notice } from "../../shared/ui";
import { errorMessage } from "../../shared/host/error";
import { generationApi } from "./api";
import { ResultResubmitDialog } from "./ResultResubmitDialog";
import { SubmissionSummary } from "./SubmissionSummary";
import { useResultImage } from "./use-result-image";
import { resultFilename } from "./result-file";
import { ImageResultActions } from "./ImageResultActions";
import type { ImageOperationAction } from "../workbench/image-operation";

export function ResultDetail({
  result,
  onClose,
  onRestore,
  onUseSeed,
  onImageOperation,
  canMaxEnhance,
}: {
  result: GenerationResult;
  onClose: () => void;
  onRestore: (draft: Draft) => void;
  onUseSeed: (seed: number) => void;
  onImageOperation: (id: string, kind: ImageOperationAction) => void;
  canMaxEnhance: boolean;
}) {
  const image = useResultImage(result.id, result.mimeType, result.available);
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
      const draft = await generationApi.restore(result.id);
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
    <Modal open onClose={onClose} title={`生成结果 · 样本 ${result.sampleIndex + 1}`} wide>
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
          <p className="generation-muted">
            <time dateTime={new Date(result.createdAt).toISOString()}>
              {new Date(result.createdAt).toLocaleString()}
            </time>
          </p>
          <SubmissionSummary submission={result.submission} />
          <ImageResultActions
            assetId={result.assetId}
            available={result.available}
            onRestore={(draft) => {
              onRestore(draft);
              onClose();
            }}
            onImageOperation={(id, kind) => {
              onImageOperation(id, kind);
              onClose();
            }}
            canMaxEnhance={canMaxEnhance}
          />
          {result.submission.kind === "generation" && (
            <p className="generation-muted">
              {result.seed === null
                ? "图片未记录样本种子；恢复时使用原提交种子，无法据此精确重现此样本。"
                : `样本种子：${result.seed}`}
            </p>
          )}
          <div className="generation-detail-actions">
            {image.url && (
              <a className="result-download" href={image.url} download={resultFilename(result)}>
                下载原图
              </a>
            )}
            {result.seed !== null && result.available && (
              <Button
                onClick={() => {
                  onUseSeed(result.seed!);
                  onClose();
                }}
              >
                仅使用样本种子
              </Button>
            )}
            <Button
              onClick={() => {
                setConfirmRestore(true);
                setError(null);
              }}
              disabled={restoring || !result.available}
            >
              <ArrowUpLeft size={14} />
              恢复到当前创作
            </Button>
            <Button onClick={() => setResubmitOpen(true)} disabled={restoring || !result.available}>
              <RotateCw size={14} />
              再次生成
            </Button>
          </div>
          {confirmRestore && (
            <fieldset className="generation-restore-confirm">
              <legend>替换当前创作？</legend>
              <p>
                当前提示词、配方与设置将替换为此结果保存的独立内容，并自动保存。此操作不会发起生成。
              </p>
              <div className="generation-dialog-actions">
                <Button disabled={restoring} onClick={() => setConfirmRestore(false)}>
                  保留当前创作
                </Button>
                <Button className="primary" disabled={restoring} onClick={() => void restore()}>
                  {restoring ? "正在恢复…" : "替换当前创作"}
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
