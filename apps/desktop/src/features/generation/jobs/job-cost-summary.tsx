import { t, useTranslation, formatDate } from "@/shared/i18n";
import type { JobSummary } from "@/bindings/generation";
import { settlementSummary } from "./job-observation";

/** Request observations and sampled balances are not an inferred charge. */
export function JobCostSummary({ job }: { job: JobSummary }) {
  useTranslation();

  const observation = job.observation;
  if (!observation) return null;
  const outcome = observation.outcome;
  return (
    <details className="generation-job-cost">
      <summary>
        {t("generation.costPrefix")}{" "}
        {observation.estimatedAnlas === null
          ? t("generation.estimateUnknown")
          : t("generation.estimatedAnlas", { value0: observation.estimatedAnlas })}
      </summary>
      <dl className="generation-metadata">
        <div>
          <dt>{t("generation.status")}</dt>
          <dd>{settlementSummary(outcome, job.operation.kind)}</dd>
        </div>
        {observation.account && (
          <>
            <div>
              <dt>{t("generation.accountSample")}</dt>
              <dd>
                {observation.account.sampledAt === null
                  ? t("generation.timeUnknown")
                  : formatDate(observation.account.sampledAt)}
              </dd>
            </div>
            <div>
              <dt>{t("generation.sampledBalance")}</dt>
              <dd>
                {observation.account.anlasBalance}
                {t("generation.anlasSuffix")}
              </dd>
            </div>
            {observation.account.v5Usage && (
              <div>
                <dt>{t("generation.v5Quota")}</dt>
                <dd>
                  {observation.account.v5Usage.isNegative ? "−" : ""}
                  {observation.account.v5Usage.percent}%
                </dd>
              </div>
            )}
          </>
        )}
      </dl>
      <p className="generation-muted">{t("generation.taskCostHelp")}</p>
    </details>
  );
}
