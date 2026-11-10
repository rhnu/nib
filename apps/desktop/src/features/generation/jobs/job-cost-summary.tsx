import { Grid } from "@/shared/ui";

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
    <details className="generation-job-cost [&_summary]:cursor-pointer [&_summary]:text-muted [&_dl]:mt-space-3 [&_.generation-metadata_>_div]:grid-cols-[64px_minmax(0,_1fr)] py-space-2 px-0 w-full text-caption">
      <summary>
        {t("generation.costPrefix")}{" "}
        {observation.estimatedAnlas === null
          ? t("generation.estimateUnknown")
          : t("generation.estimatedAnlas", { value0: observation.estimatedAnlas })}
      </summary>
      <Grid
        gap={0}
        align="stretch"
        columns={1}
        as="dl"
        className="generation-metadata [&_>_div]:grid-cols-[76px_minmax(0,_1fr)] [&_dt]:text-muted [&_dd]:wrap-anywhere [&_>_div]:grid [&_>_div]:gap-space-3 [&_dd]:m-0 grid gap-space-3 m-0 text-label"
      >
        <Grid gap={3} columns={1} className="grid-cols-[76px_minmax(0,1fr)]">
          <dt>{t("generation.status")}</dt>
          <dd>{settlementSummary(outcome, job.operation.kind)}</dd>
        </Grid>
        {observation.account && (
          <>
            <Grid gap={3} columns={1} className="grid-cols-[76px_minmax(0,1fr)]">
              <dt>{t("generation.accountSample")}</dt>
              <dd>
                {observation.account.sampledAt === null
                  ? t("generation.timeUnknown")
                  : formatDate(observation.account.sampledAt)}
              </dd>
            </Grid>
            <Grid gap={3} columns={1} className="grid-cols-[76px_minmax(0,1fr)]">
              <dt>{t("generation.sampledBalance")}</dt>
              <dd>
                {observation.account.anlasBalance}
                {t("generation.anlasSuffix")}
              </dd>
            </Grid>
            {observation.account.v5Usage && (
              <Grid gap={3} columns={1} className="grid-cols-[76px_minmax(0,1fr)]">
                <dt>{t("generation.v5Quota")}</dt>
                <dd>
                  {observation.account.v5Usage.isNegative ? "−" : ""}
                  {observation.account.v5Usage.percent}%
                </dd>
              </Grid>
            )}
          </>
        )}
      </Grid>
      <p className="generation-muted text-muted">{t("generation.taskCostHelp")}</p>
    </details>
  );
}
