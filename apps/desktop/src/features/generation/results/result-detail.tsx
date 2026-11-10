import { Button, Modal, Notice, Grid, Row, Col, Toolbar } from "@/shared/ui";

import { SafetyImage } from "@/features/media/safety-image";
import { t, useTranslation, useMessageState } from "@/shared/i18n";
import { useMediaQuery } from "@/features/media/use-media-query";
import { resultsApi } from "./api";
import { useEffect, useRef, useState } from "react";
import { ArrowUpLeft, RotateCw } from "lucide-react";
import type { Draft } from "@/bindings/workbench";
import type { GenerationResult } from "@/bindings/generation";

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
      <Grid
        gap={0}
        align="stretch"
        className="generation-detail [&_button]:shrink-0 [&_p]:m-0 grid grid-cols-[minmax(0,_1.4fr)_minmax(260px,_0.8fr)] flex-1 min-h-0 overflow-auto max-[950px]:grid-cols-1"
      >
        <Row
          gap={0}
          className="generation-detail-image [&_img]:w-full [&_img]:max-h-[75vh] [&_img]:object-contain max-[950px]:[&_img]:max-h-[45vh] flex items-center justify-center min-h-[250px] p-space-5 bg-background"
        >
          {!result.available ? (
            <p className="generation-muted text-muted">{t("generation.mediaMissing")}</p>
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
        </Row>
        <Col
          gap={0}
          align="stretch"
          className="generation-detail-info flex flex-col gap-space-5 p-[18px] overflow-auto min-w-0"
        >
          <SubmissionSummary submission={result.submission} />
          {result.submission.kind === "generation" && (
            <p className="generation-muted text-muted">
              {result.seed === null
                ? t("generation.sampleSeedMissingHelp")
                : t("generation.sampleSeedValue", { value0: result.seed })}
            </p>
          )}
          <Toolbar
            gap={2}
            className="ui-actions flex items-center justify-end flex-wrap gap-space-3"
          >
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
          </Toolbar>
          {confirmRestore && (
            <Grid
              gap={0}
              align="stretch"
              columns={1}
              as="fieldset"
              className="generation-restore-confirm grid gap-[10px] p-space-4 border border-accent bg-accent-soft rounded-control"
            >
              <legend>
                {isDirector
                  ? t("generation.replaceToolInputTitle")
                  : t("generation.replaceCreationTitle")}
              </legend>
              <p>
                {isDirector ? t("generation.restoreToolHelp") : t("generation.restoreCreationHelp")}
              </p>
              <Toolbar
                gap={2}
                className="ui-actions flex items-center justify-end flex-wrap gap-space-3"
              >
                <Button disabled={restoring} onClick={() => setConfirmRestore(false)}>
                  {isDirector ? t("generation.keepToolInput") : t("generation.keepCreation")}
                </Button>
                <Button
                  variant="primary"
                  className=""
                  disabled={restoring}
                  onClick={() => void restore()}
                >
                  {restoring
                    ? t("generation.restoring")
                    : isDirector
                      ? t("generation.restoreToolInput")
                      : t("generation.replaceCreation")}
                </Button>
              </Toolbar>
            </Grid>
          )}
          {error && <Notice>{error}</Notice>}
        </Col>
      </Grid>
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
      <Col
        gap={0}
        align="stretch"
        className="generation-dialog-body flex flex-col gap-space-4 p-0 overflow-auto [&_button]:shrink-0 [&_p]:m-0"
      >
        {detail.error ? (
          <Notice actions={<Button onClick={detail.retry}>{t("generation.retryLoad")}</Button>}>
            {detail.error}
          </Notice>
        ) : (
          <output>{t("generation.loadingResultDetails")}</output>
        )}
      </Col>
    </Modal>
  );
}
