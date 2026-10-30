import { t, useTranslation, formatDate } from "@/shared/i18n";
import { useAccount } from "./account-context";

export function AccountSnapshot({ compact = false }: { compact?: boolean }) {
  useTranslation();

  const { accountSummary: summary, accountSummaryLoading, accountSummaryStale } = useAccount();
  if (!summary && compact) return null;
  if (!summary)
    return (
      <p className="generation-muted generation-account-snapshot">
        {accountSummaryLoading
          ? t("generation.loadingAccountSnapshot")
          : t("generation.noAccountSnapshot")}
      </p>
    );
  const sampled =
    summary.sampledAt === null
      ? t("generation.snapshotTimeUnknown")
      : formatDate(summary.sampledAt);
  if (compact)
    return (
      <div
        className="generation-account-snapshot generation-muted"
        title={t("generation.snapshotSummary", { value0: sampled })}
      >
        <span>
          {t("generation.balancePrefix")}
          {summary.anlasBalance}
          {t("generation.anlasSuffix")}
        </span>
        {summary.v5Usage && (
          <span>
            {t("generation.v5QuotaPrefix")}
            {summary.v5Usage.isNegative ? "−" : ""}
            {summary.v5Usage.percent}%
          </span>
        )}
        <span>
          {accountSummaryLoading
            ? t("generation.refreshing")
            : accountSummaryStale
              ? t("generation.staleSnapshot")
              : t("generation.accountSnapshot")}
        </span>
      </div>
    );
  return (
    <div className="generation-account-snapshot-details">
      {accountSummaryStale && (
        <p className="generation-muted">{t("generation.staleSnapshotHelp")}</p>
      )}
      <dl className="generation-metadata">
        <div>
          <dt>{t("generation.anlasBalance")}</dt>
          <dd>{summary.anlasBalance}</dd>
        </div>
        <div>
          <dt>{t("generation.subscription")}</dt>
          <dd>
            {summary.subscriptionActive
              ? t("generation.activeSubscription", { value0: summary.tier })
              : t("generation.inactive")}
          </dd>
        </div>
        {summary.expiresAtMs !== null && (summary.subscriptionActive || summary.tier > 0) && (
          <div>
            <dt>{t("generation.subscriptionExpiry")}</dt>
            <dd>{formatDate(summary.expiresAtMs)}</dd>
          </div>
        )}
        {summary.v5Usage && (
          <>
            <div>
              <dt>{t("generation.v5Quota")}</dt>
              <dd>
                {summary.v5Usage.isNegative ? "−" : ""}
                {summary.v5Usage.percent}%
              </dd>
            </div>
            <div>
              <dt>{t("generation.purchasedQuota")}</dt>
              <dd>{summary.v5Usage.purchasedPercent}%</dd>
            </div>
            <div>
              <dt>{t("generation.nextPercentRecovery")}</dt>
              <dd>
                {t("generation.snapshotSeconds", {
                  count: summary.v5Usage.secondsUntilNextPercent,
                })}
              </dd>
            </div>
          </>
        )}
        <div>
          <dt>{t("generation.snapshotTime")}</dt>
          <dd>{sampled}</dd>
        </div>
      </dl>
      <p className="generation-muted">{t("generation.snapshotCostHelp")}</p>
    </div>
  );
}
