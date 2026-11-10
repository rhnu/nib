import { Grid, Button, Modal, Notice } from "@/shared/ui";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { t, useTranslation, useMessageState, formatNumber, formatDate } from "@/shared/i18n";

import { errorMessage } from "@/shared/host/error";
import { safetyApi } from "./safety-api";
import { useImageSafety } from "./safety-image";
import type { RatingScores } from "@/bindings/safety";
import { safetyReason } from "./safety-labels";

function Scores({ scores }: { scores: RatingScores }) {
  return (
    <Grid
      columns={1}
      align="stretch"
      as="dl"
      gap={0}
      minColumnWidth="0px"
      className="image-safety-scores [&_>_div]:flex [&_>_div]:justify-between [&_>_div]:gap-space-4 [&_dd]:m-0 grid grid-cols-2 gap-[6px_16px] m-0"
    >
      {(Object.keys(scores) as (keyof RatingScores)[]).map((key) => (
        <div key={key}>
          <dt>{t(`safety.rating_${key}`)}</dt>
          <dd>{formatNumber(scores[key], { maximumFractionDigits: 4 })}</dd>
        </div>
      ))}
    </Grid>
  );
}

/** Assessment failures stay explicit and never turn an unknown image into a safe verdict. */
export function ImageSafetyDialog({ assetId, onClose }: { assetId: string; onClose: () => void }) {
  useTranslation();
  const safety = useImageSafety(assetId);
  const client = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useMessageState();
  const assessment = safety.data?.assessment;

  const recheck = async () => {
    setChecking(true);
    setError(null);
    try {
      const result = await safetyApi.rescan(assetId);
      client.setQueriesData({ queryKey: ["image-safety", assetId] }, result);
    } catch (cause) {
      setError(cause);
    } finally {
      setChecking(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={t("safety.info")}>
      <Grid
        align="stretch"
        gap={0}
        columns={1}
        minColumnWidth="0px"
        className="image-safety-fields grid gap-space-4 p-space-5 [border:0] m-0 min-w-0"
      >
        <strong>{safety.data ? t(`safety.${safety.data.status}`) : t("safety.checking")}</strong>
        <Button disabled={checking} onClick={() => void recheck()}>
          {checking ? t("safety.checking") : t("safety.recheck")}
        </Button>
        {assessment && (
          <>
            {safety.data?.status === "unknown" && (
              <p className="image-safety-hint text-label text-muted">
                {t("safety.previousEvidence")}
              </p>
            )}
            <h3>{t("safety.rating")}</h3>
            <Scores scores={assessment.primary.ratings} />
            <h3>{t("safety.fused")}</h3>
            <output>
              {formatNumber(assessment.primary.fusedScore, { maximumFractionDigits: 4 })}
            </output>
            <Grid
              columns={1}
              align="stretch"
              as="dl"
              gap={0}
              minColumnWidth="0px"
              className="image-safety-scores [&_>_div]:flex [&_>_div]:justify-between [&_>_div]:gap-space-4 [&_dd]:m-0 grid grid-cols-2 gap-[6px_16px] m-0"
            >
              <div>
                <dt>{t("safety.model")}</dt>
                <dd>
                  {assessment.primary.modelId} · {assessment.primary.modelVersion}
                </dd>
              </div>
              <div>
                <dt>{t("safety.policy")}</dt>
                <dd>{assessment.policyVersion}</dd>
              </div>
              <div>
                <dt>{t("safety.assessedAt")}</dt>
                <dd>{formatDate(assessment.assessedAt)}</dd>
              </div>
            </Grid>
            {assessment.review && (
              <section>
                <h3>{t("safety.review")}</h3>
                <p>{t(`safety.review_${assessment.review.kind}`)}</p>
                {assessment.review.kind === "completed" && (
                  <>
                    <Scores scores={assessment.review.evidence.ratings} />
                    <p>
                      {t("safety.fused")}:{" "}
                      {formatNumber(assessment.review.evidence.fusedScore, {
                        maximumFractionDigits: 4,
                      })}
                    </p>
                    <p className="image-safety-hint text-label text-muted">
                      {assessment.review.evidence.modelId} ·{" "}
                      {assessment.review.evidence.modelVersion}
                    </p>
                  </>
                )}
                {assessment.review.kind === "failed" && (
                  <Notice>{assessment.review.message}</Notice>
                )}
              </section>
            )}
          </>
        )}
        {safety.data?.reason && <Notice>{safetyReason(safety.data.reason)}</Notice>}
        {safety.error && (
          <Notice
            actions={<Button onClick={() => void safety.refetch()}>{t("safety.recheck")}</Button>}
          >
            {errorMessage(safety.error)}
          </Notice>
        )}
        {error && <Notice>{error}</Notice>}
      </Grid>
    </Modal>
  );
}
