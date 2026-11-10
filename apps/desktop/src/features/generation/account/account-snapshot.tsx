import { Row, Grid } from "@/shared/ui";

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
      <Row
        gap={0}
        as="span"
        className="generation-account-metric [&_strong]:tabular-nums [&_>_svg]:shrink-0 inline-flex items-center gap-space-2"
        title={t("generation.anlasBalance")}
      >
        <Gem size={18} aria-hidden />
        <span className="sr-only">{t("generation.anlasBalance")}: </span>
        <strong>{summary ? formatNumber(summary.anlasBalance) : "—"}</strong>
      </Row>
      <Row
        gap={0}
        as="span"
        className="generation-account-metric [&_strong]:tabular-nums [&_>_svg]:shrink-0 inline-flex items-center gap-space-2"
        title={quotaLabel}
      >
        <Zap size={18} aria-hidden />
        <span className="sr-only">{t("generation.opusQuota")}: </span>
        <strong>{summary?.v5Usage ? allowanceText(summary.v5Usage) : "—"}</strong>
      </Row>
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
        <Row
          gap={0}
          className="generation-account-balance [&_svg]:text-accent [&_.generation-account-metric_>_svg]:w-[16px] [&_.generation-account-metric_>_svg]:h-[16px] flex items-center flex-wrap gap-y-space-3 gap-x-[18px] min-h-[28px] py-space-1 px-space-3 border border-line bg-background text-label leading-[16px]"
        >
          <span className="generation-muted text-muted">{t("generation.accountRequired")}</span>
        </Row>
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
      <Row
        gap={0}
        className="generation-account-balance [&_svg]:text-accent [&_.generation-account-metric_>_svg]:w-[16px] [&_.generation-account-metric_>_svg]:h-[16px] flex items-center flex-wrap gap-y-space-3 gap-x-[18px] min-h-[28px] py-space-1 px-space-3 border border-line bg-background text-label leading-[16px]"
        aria-live="polite"
        title={state}
      >
        <AccountBalances summary={summary} />
        {accountSummaryLoading || accountLoading ? (
          <LoaderCircle size={13} className="spin" aria-label={t("generation.refreshing")} />
        ) : (
          (accountSummaryStale || accountSummaryError) && (
            <span className="generation-balance-state ml-auto text-muted text-caption">
              {accountSummaryError
                ? t("generation.accountReadFailed")
                : t("generation.staleSnapshot")}
            </span>
          )
        )}
      </Row>
    );
  }
  if (!summary)
    return (
      <Row
        gap={0}
        align="stretch"
        as="p"
        className="generation-muted text-muted generation-account-snapshot flex flex-wrap gap-y-space-1 gap-x-[10px] m-0 text-caption leading-[1.6]"
      >
        {accountSummaryLoading
          ? t("generation.loadingAccountSnapshot")
          : t("generation.noAccountSnapshot")}
      </Row>
    );
  const tierName = summary.tierName
    ? summary.tierName.charAt(0).toUpperCase() + summary.tierName.slice(1)
    : t("generation.subscriptionTier", { value0: summary.tier });
  return (
    <Grid
      gap={0}
      align="stretch"
      columns={1}
      className="generation-account-snapshot-details grid gap-space-5"
      aria-live="polite"
    >
      <Row
        gap={0}
        className="generation-account-metrics [&_>_.generation-account-metric_>_svg]:text-accent [&_strong]:text-page [&_strong]:font-semibold [&_strong]:leading-[1.3] [&_>_.generation-account-recovery_>_svg]:text-muted flex items-center flex-wrap gap-y-space-4 gap-x-space-6"
      >
        <AccountBalances summary={summary} />
        {summary.v5Usage && (
          <Row
            gap={0}
            as="span"
            className="generation-account-metric [&_strong]:tabular-nums [&_>_svg]:shrink-0 inline-flex items-center gap-space-2 generation-account-recovery [&_>_span:not(.sr-only)]:text-muted [&.generation-account-recovery_strong]:text-title [&.generation-account-recovery_strong]:font-medium"
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
          </Row>
        )}
        {accountSummaryLoading && (
          <LoaderCircle size={14} className="spin" aria-label={t("generation.refreshing")} />
        )}
        {accountSummaryStale && (
          <span className="generation-account-status text-muted text-label">
            {t("generation.staleSnapshot")}
          </span>
        )}
      </Row>
      <Row
        gap={0}
        className="generation-account-subscription [&_svg]:text-muted flex items-center flex-wrap gap-y-space-4 gap-x-space-6 text-body"
      >
        <Row
          gap={0}
          as="span"
          className="generation-account-metric [&_strong]:tabular-nums [&_>_svg]:shrink-0 inline-flex items-center gap-space-2"
          title={t("generation.subscription")}
        >
          <Crown size={16} aria-hidden />
          <span className="sr-only">{t("generation.subscription")}: </span>
          <span>{tierName}</span>
          {!summary.subscriptionActive && summary.tier > 0 && (
            <span className="generation-account-status text-muted text-label">
              {t("generation.inactive")}
            </span>
          )}
        </Row>
        {summary.expiresAtMs !== null && (summary.subscriptionActive || summary.tier > 0) && (
          <Row
            gap={0}
            as="span"
            className="generation-account-metric [&_strong]:tabular-nums [&_>_svg]:shrink-0 inline-flex items-center gap-space-2"
            title={t("generation.subscriptionExpiry")}
          >
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
          </Row>
        )}
      </Row>
    </Grid>
  );
}
