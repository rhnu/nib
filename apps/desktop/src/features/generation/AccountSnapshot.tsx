import { useGeneration } from "./generation-context";

export function AccountSnapshot({ compact = false }: { compact?: boolean }) {
  const { accountSummary: summary, accountSummaryLoading } = useGeneration();
  if (!summary)
    return (
      <p className="generation-muted generation-account-snapshot">
        {accountSummaryLoading ? "正在读取账户快照…" : "尚未查询账户，按非订阅条件估费"}
      </p>
    );
  const sampled =
    summary.sampledAt === null ? "采样时间未知" : new Date(summary.sampledAt).toLocaleString();
  if (compact)
    return (
      <div className="generation-account-snapshot generation-muted" title={`账户快照 · ${sampled}`}>
        <span>余额 {summary.anlasBalance} Anlas</span>
        {summary.v5Usage && (
          <span>
            V5 额度 {summary.v5Usage.isNegative ? "−" : ""}
            {summary.v5Usage.percent}%
          </span>
        )}
        <span>{accountSummaryLoading ? "刷新中…" : "账户快照"}</span>
      </div>
    );
  return (
    <div className="generation-account-snapshot-details">
      <dl className="generation-metadata">
        <div>
          <dt>Anlas 余额</dt>
          <dd>{summary.anlasBalance}</dd>
        </div>
        <div>
          <dt>订阅</dt>
          <dd>{summary.subscriptionActive ? `有效 · 等级 ${summary.tier}` : "未激活"}</dd>
        </div>
        {summary.expiresAtMs !== null && (summary.subscriptionActive || summary.tier > 0) && (
          <div>
            <dt>订阅到期</dt>
            <dd>{new Date(summary.expiresAtMs).toLocaleString()}</dd>
          </div>
        )}
        {summary.v5Usage && (
          <>
            <div>
              <dt>V5 额度</dt>
              <dd>
                {summary.v5Usage.isNegative ? "−" : ""}
                {summary.v5Usage.percent}%
              </dd>
            </div>
            <div>
              <dt>已购额度</dt>
              <dd>{summary.v5Usage.purchasedPercent}%</dd>
            </div>
            <div>
              <dt>下一百分点恢复</dt>
              <dd>{summary.v5Usage.secondsUntilNextPercent} 秒（采样时）</dd>
            </div>
          </>
        )}
        <div>
          <dt>采样时间</dt>
          <dd>{sampled}</dd>
        </div>
      </dl>
      <p className="generation-muted">余额与额度是采样值，费用估算不代表实际扣费。</p>
    </div>
  );
}
