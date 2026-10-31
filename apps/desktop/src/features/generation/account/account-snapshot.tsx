import { t, useTranslation, formatDate } from "@/shared/i18n";
import { useAccount } from "./account-context";
import { Gem, LoaderCircle, Zap } from "lucide-react";

export function AccountSnapshot({ compact = false }: { compact?: boolean }) {
  useTranslation();

  const {
    account,
    accountLoading,
    accountSummary: summary,
    accountSummaryLoading,
    accountSummaryStale,
    accountSummaryError,
  } = useAccount();
  if (compact) {
    if (!account?.configured && !accountLoading)
      return (
        <div className="generation-account-balance">
          <span className="generation-muted">{t("generation.accountRequired")}</span>
        </div>
      );
    const sampled =
      summary?.sampledAt == null
        ? t("generation.snapshotTimeUnknown")
        : formatDate(summary.sampledAt);
    const state =
      accountSummaryLoading || accountLoading
        ? t("generation.refreshing")
        : accountSummaryError
          ? accountSummaryError
          : accountSummaryStale
            ? t("generation.staleSnapshot")
            : t("generation.snapshotSummary", { value0: sampled });
    return (
      <div className="generation-account-balance" aria-live="polite" title={state}>
        <span title={t("generation.anlasBalance")}>
          <Gem size={16} aria-hidden />
          <span className="sr-only">{t("generation.anlasBalance")}: </span>
          <strong>{summary?.anlasBalance ?? "—"}</strong>
        </span>
        <span title={t("generation.opusQuota")}>
          <Zap size={16} aria-hidden />
          <span className="sr-only">{t("generation.opusQuota")}: </span>
          <strong>
            {summary?.v5Usage
              ? `${summary.v5Usage.isNegative ? "−" : ""}${summary.v5Usage.percent}%`
              : "—"}
          </strong>
        </span>
        {accountSummaryLoading || accountLoading ? (
          <LoaderCircle size={13} className="spin" aria-label={t("generation.refreshing")} />
        ) : (
          (accountSummaryStale || accountSummaryError) && (
            <span className="generation-balance-state">
              {accountSummaryError
                ? t("generation.accountReadFailed")
                : t("generation.staleSnapshot")}
            </span>
          )
        )}
      </div>
    );
  }
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
