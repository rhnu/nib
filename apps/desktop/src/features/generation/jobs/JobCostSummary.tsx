import type { JobSummary } from "../../../bindings/generation";
import { settlementSummary } from "./job-observation";

/** Request observations and sampled balances are not an inferred charge. */
export function JobCostSummary({ job }: { job: JobSummary }) {
  const observation = job.observation;
  if (!observation) return null;
  const outcome = observation.outcome;
  return (
    <details className="generation-job-cost">
      <summary>
        费用 ·{" "}
        {observation.estimatedAnlas === null
          ? "估算未知"
          : `估算 ${observation.estimatedAnlas} Anlas`}
      </summary>
      <dl className="generation-metadata">
        <div>
          <dt>状态</dt>
          <dd>{settlementSummary(outcome, job.operation.kind)}</dd>
        </div>
        {observation.account && (
          <>
            <div>
              <dt>账户采样</dt>
              <dd>
                {observation.account.sampledAt === null
                  ? "时间未知"
                  : new Date(observation.account.sampledAt).toLocaleString()}
              </dd>
            </div>
            <div>
              <dt>采样余额</dt>
              <dd>{observation.account.anlasBalance} Anlas</dd>
            </div>
            {observation.account.v5Usage && (
              <div>
                <dt>V5 额度</dt>
                <dd>
                  {observation.account.v5Usage.isNegative ? "−" : ""}
                  {observation.account.v5Usage.percent}%
                </dd>
              </div>
            )}
          </>
        )}
      </dl>
      <p className="generation-muted">估算与账户采样不代表此次实际扣费。</p>
    </details>
  );
}
