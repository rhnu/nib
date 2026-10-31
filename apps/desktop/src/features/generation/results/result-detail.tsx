import { SafetyImage } from "@/features/media/safety-image";
import { t, useTranslation, useMessageState } from "@/shared/i18n";
import { useMediaQuery } from "@/features/media/use-media-query";
import { resultsApi } from "./api";
import { useEffect, useRef, useState } from "react";
import { ArrowUpLeft, RotateCw } from "lucide-react";
import type { Draft } from "@/bindings/workbench";
import type { GenerationResult } from "@/bindings/generation";
import { Button, Modal, Notice } from "@/shared/ui";
import { ResultResubmitDialog } from "./result-resubmit-dialog";
import { SubmissionSummary } from "../submission/submission-summary";
import { useMediaContent } from "@/features/media/use-media-content";
import type { ImageOperationAction } from "@/features/inputs/image-operation";
import { ImageContextActions } from "@/features/media/image-context-actions";
import { resultFilename } from "./result-file";

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
  useTranslation();

  const isDirector = result.submission.kind === "director";
  const image = useMediaContent(result.assetId, result.mimeType, result.available);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [resubmitOpen, setResubmitOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useMessageState();
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
      if (active.current) setError(cause);
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
          ? t("generation.directorOutputLabel", { value0: result.sampleIndex + 1 })
          : t("generation.generationSampleLabel", { value0: result.sampleIndex + 1 })
      }
      wide
    >
      <div className="generation-detail">
        <div className="generation-detail-image">
          {!result.available ? (
            <p className="generation-muted">{t("generation.mediaMissing")}</p>
          ) : image.error ? (
            <Notice actions={<Button onClick={image.retry}>{t("generation.retryLoad")}</Button>}>
              {image.error}
            </Notice>
          ) : image.url ? (
            <ImageContextActions
              id={result.assetId}
              mimeType={result.mimeType}
              available={result.available}
              filename={resultFilename(result)}
            >
              <SafetyImage
                assetId={result.assetId}
                details
                src={image.url}
                alt={
                  result.seed === null
                    ? t("generation.resultSeedMissing")
                    : t("generation.resultSeedLabel", { value0: result.seed })
                }
                onError={image.failed}
              />
            </ImageContextActions>
          ) : (
            <output>{t("generation.loadingResultImage")}</output>
          )}
        </div>
        <div className="generation-detail-info">
          <SubmissionSummary submission={result.submission} />
          {result.submission.kind === "generation" && (
            <p className="generation-muted">
              {result.seed === null
                ? t("generation.sampleSeedMissingHelp")
                : t("generation.sampleSeedValue", { value0: result.seed })}
            </p>
          )}
          <div className="ui-actions">
            <Button
              onClick={() => {
                setConfirmRestore(true);
                setError(null);
              }}
              disabled={restoring || !result.available}
            >
              <ArrowUpLeft size={14} />
              {isDirector ? t("generation.restoreToolInput") : t("generation.restoreToCreation")}
            </Button>
            <Button onClick={() => setResubmitOpen(true)} disabled={restoring || !result.available}>
              <RotateCw size={14} />
              {isDirector ? t("generation.processAgain") : t("generation.generateAgain")}
            </Button>
          </div>
          {confirmRestore && (
            <fieldset className="generation-restore-confirm">
              <legend>
                {isDirector
                  ? t("generation.replaceToolInputTitle")
                  : t("generation.replaceCreationTitle")}
              </legend>
              <p>
                {isDirector ? t("generation.restoreToolHelp") : t("generation.restoreCreationHelp")}
              </p>
              <div className="ui-actions">
                <Button disabled={restoring} onClick={() => setConfirmRestore(false)}>
                  {isDirector ? t("generation.keepToolInput") : t("generation.keepCreation")}
                </Button>
                <Button className="primary" disabled={restoring} onClick={() => void restore()}>
                  {restoring
                    ? t("generation.restoring")
                    : isDirector
                      ? t("generation.restoreToolInput")
                      : t("generation.replaceCreation")}
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
  useTranslation();

  const detail = useMediaQuery(
    ["results", "detail", props.result.id],
    props.result.id,
    resultsApi.get,
  );
  if (detail.value) return <ResultDetailContent {...props} result={detail.value} />;
  return (
    <Modal open onClose={props.onClose} title={t("generation.generationResult")}>
      <div className="generation-dialog-body">
        {detail.error ? (
          <Notice actions={<Button onClick={detail.retry}>{t("generation.retryLoad")}</Button>}>
            {detail.error}
          </Notice>
        ) : (
          <output>{t("generation.loadingResultDetails")}</output>
        )}
      </div>
    </Modal>
  );
}
