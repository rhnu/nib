import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { t, useTranslation, useMessageState, formatNumber, formatDate } from "@/shared/i18n";
import { Button, Modal, Notice } from "@/shared/ui";
import { errorMessage } from "@/shared/host/error";
import { safetyApi } from "./safety-api";
import { useImageSafety } from "./safety-image";
import type { RatingScores } from "@/bindings/safety";
import { safetyReason } from "./safety-labels";

function Scores({ scores }: { scores: RatingScores }) {
  return (
    <dl className="image-safety-scores">
      {(Object.keys(scores) as (keyof RatingScores)[]).map((key) => (
        <div key={key}>
          <dt>{t(`safety.rating_${key}`)}</dt>
          <dd>{formatNumber(scores[key], { maximumFractionDigits: 4 })}</dd>
        </div>
      ))}
    </dl>
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
      <div className="image-safety-fields">
        <strong>{safety.data ? t(`safety.${safety.data.status}`) : t("safety.checking")}</strong>
        <Button disabled={checking} onClick={() => void recheck()}>
          {checking ? t("safety.checking") : t("safety.recheck")}
        </Button>
        {assessment && (
          <>
            {safety.data?.status === "unknown" && (
              <p className="image-safety-hint">{t("safety.previousEvidence")}</p>
            )}
            <h3>{t("safety.rating")}</h3>
            <Scores scores={assessment.primary.ratings} />
            <h3>{t("safety.fused")}</h3>
            <output>
              {formatNumber(assessment.primary.fusedScore, { maximumFractionDigits: 4 })}
            </output>
            <dl className="image-safety-scores">
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
            </dl>
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
                    <p className="image-safety-hint">
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
      </div>
    </Modal>
  );
}
