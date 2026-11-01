import { t, useTranslation, formatDate, formatNumber } from "@/shared/i18n";
import type { AccountSummary } from "@/bindings/generation";
import { useAccount } from "./account-context";
import { CalendarDays, Crown, Gem, LoaderCircle, Timer, Zap } from "lucide-react";
import { allowanceText, recoveryHours } from "./account-display";

/** Settings and the generation footer present the same balances at different sizes. */
function AccountBalances({ summary }: { summary: AccountSummary | null }) {
  const quotaLabel = [
    t("generation.opusQuota"),
    ...(summary?.v5Usage && summary.v5Usage.purchasedPercent > 0
      ? [`${t("generation.purchasedQuota")} ${summary.v5Usage.purchasedPercent}%`]
      : []),
  ].join(" · ");
  return (
    <>
      <span className="generation-account-metric" title={t("generation.anlasBalance")}>
        <Gem size={18} aria-hidden />
        <span className="sr-only">{t("generation.anlasBalance")}: </span>
        <strong>{summary ? formatNumber(summary.anlasBalance) : "—"}</strong>
      </span>
      <span className="generation-account-metric" title={quotaLabel}>
        <Zap size={18} aria-hidden />
        <span className="sr-only">{t("generation.opusQuota")}: </span>
        <strong>{summary?.v5Usage ? allowanceText(summary.v5Usage) : "—"}</strong>
      </span>
    </>
  );
}

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
    const state =
      accountSummaryLoading || accountLoading
        ? t("generation.refreshing")
        : accountSummaryError
          ? accountSummaryError
          : accountSummaryStale
            ? t("generation.staleSnapshot")
            : t("generation.subscriptionBalance");
    return (
      <div className="generation-account-balance" aria-live="polite" title={state}>
        <AccountBalances summary={summary} />
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
  const tierName = summary.tierName
    ? summary.tierName.charAt(0).toUpperCase() + summary.tierName.slice(1)
    : t("generation.subscriptionTier", { value0: summary.tier });
  return (
    <div className="generation-account-snapshot-details" aria-live="polite">
      <div className="generation-account-metrics">
        <AccountBalances summary={summary} />
        {summary.v5Usage && (
          <span
            className="generation-account-metric generation-account-recovery"
            title={t("generation.nextPercentRecovery")}
          >
            <Timer size={18} aria-hidden />
            <span className="sr-only">{t("generation.nextPercentRecovery")}: </span>
            <strong>
              {t("generation.recoveryHours", {
                value0: formatNumber(recoveryHours(summary.v5Usage.secondsUntilNextPercent)),
              })}
            </strong>
            <span>{t("generation.restoreOnePercent")}</span>
          </span>
        )}
        {accountSummaryLoading && (
          <LoaderCircle size={14} className="spin" aria-label={t("generation.refreshing")} />
        )}
        {accountSummaryStale && (
          <span className="generation-account-status">{t("generation.staleSnapshot")}</span>
        )}
      </div>
      <div className="generation-account-subscription">
        <span className="generation-account-metric" title={t("generation.subscription")}>
          <Crown size={16} aria-hidden />
          <span className="sr-only">{t("generation.subscription")}: </span>
          <span>{tierName}</span>
          {!summary.subscriptionActive && summary.tier > 0 && (
            <span className="generation-account-status">{t("generation.inactive")}</span>
          )}
        </span>
        {summary.expiresAtMs !== null && (summary.subscriptionActive || summary.tier > 0) && (
          <span className="generation-account-metric" title={t("generation.subscriptionExpiry")}>
            <CalendarDays size={16} aria-hidden />
            <span className="sr-only">{t("generation.subscriptionExpiry")}: </span>
            <time dateTime={new Date(summary.expiresAtMs).toISOString()}>
              {t("generation.subscriptionExpiryValue", {
                value0: formatDate(summary.expiresAtMs, {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                }),
              })}
            </time>
          </span>
        )}
      </div>
    </div>
  );
}
