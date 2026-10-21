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

export function ResultDetail({
  result,
  onClose,
  onRestore,
}: {
  result: GenerationResult;
  onClose: () => void;
  onRestore: (draft: Draft) => void;
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
            <img src={image.url} alt={`生成结果，种子 ${result.seed}`} onError={image.failed} />
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
          <SubmissionSummary submission={{ ...result.submission, seed: result.seed }} />
          <div className="generation-detail-actions">
            <Button
              onClick={() => {
                setConfirmRestore(true);
                setError(null);
              }}
              disabled={restoring}
            >
              <ArrowUpLeft size={14} />
              恢复到当前创作
            </Button>
            <Button onClick={() => setResubmitOpen(true)} disabled={restoring}>
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
