import { IconButton, overlayStyles, Grid } from "@/shared/ui";

import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { X } from "lucide-react";
import { formatNumber, t, useTranslation } from "@/shared/i18n";
import type { TokenFieldUsage } from "@/bindings/generation";
import type { PromptTokenUsage } from "./token-usage";
import "./token-usage.css";

function usageText(usage: TokenFieldUsage | undefined): string {
  if (!usage) return "—";
  return `${formatNumber(usage.used)} / ${formatNumber(usage.limit)}${usage.overLimit ? t("generation.overLimitSuffix") : ""}`;
}

function usageRatio(usage: TokenFieldUsage | undefined): number {
  return usage && usage.limit > 0 ? Math.min(1, usage.used / usage.limit) : 0;
}

/** Outer positive and inner negative rings preserve separate model limits. */
export function TokenUsageIndicator({
  usage,
  label,
  status,
  pending = false,
}: {
  usage: PromptTokenUsage;
  label: string;
  status?: string;
  pending?: boolean;
}) {
  useTranslation();

  const [open, setOpen] = useState(false);
  const scopes = [
    { key: "positive", title: t("prompt.positive"), ring: t("prompt.outerRing"), radius: 10 },
    { key: "negative", title: t("prompt.negative"), ring: t("prompt.innerRing"), radius: 6 },
  ] as const;
  const summary = scopes
    .map(({ key, title, ring }) => `${title} (${ring}) ${usageText(usage[key])}`)
    .join(" · ");
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={<IconButton label={`${label} · ${summary}${status ? ` · ${status}` : ""}`} />}
        className="icon-button token-usage-indicator w-[30px] h-[30px] min-h-[30px] p-[1px]"
        aria-label={`${label} · ${summary}${status ? ` · ${status}` : ""}`}
        aria-busy={pending}
        openOnHover
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) setOpen(true);
        }}
      >
        <svg viewBox="0 0 26 26" width="26" height="26" aria-hidden>
          {scopes.map(({ key, radius }) => (
            <g
              key={key}
              className={`token-scope-${key}${usage[key]?.overLimit ? " over-limit [&_.token-usage-count]:text-danger" : ""}`}
            >
              <circle
                className={`token-ring-track${usage[key] ? "" : " unavailable"}`}
                cx="13"
                cy="13"
                r={radius}
              />
              <circle
                className="token-ring-value"
                cx="13"
                cy="13"
                r={radius}
                pathLength="1"
                strokeDasharray={`${usageRatio(usage[key])} 1`}
                transform="rotate(-90 13 13)"
              />
            </g>
          ))}
        </svg>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          sideOffset={6}
          align="end"
          className={`help-positioner ${overlayStyles["help-positioner"]}`}
        >
          <Popover.Popup
            className={`help-popup token-usage-popup w-[min(360px,_calc(100vw_-_24px))] ${overlayStyles["help-popup"]}`}
            initialFocus={false}
          >
            <header>
              <Popover.Title>{label}</Popover.Title>
              <Popover.Close
                render={<IconButton label={t("common.closeHelp")} />}
                className="icon-button"
                aria-label={t("common.closeHelp")}
              >
                <X size={14} aria-hidden />
              </Popover.Close>
            </header>
            <Popover.Description render={<div />}>
              {scopes.map(({ key, title, ring }) => (
                <Grid
                  gap={0}
                  key={key}
                  className={`token-usage-row grid grid-cols-[auto_minmax(32px,_1fr)_auto] items-center gap-[10px] mt-space-3 token-scope-${key}${usage[key]?.overLimit ? " over-limit [&_.token-usage-count]:text-danger" : ""}`}
                >
                  <span className="token-usage-label text-[var(--token-color)]" title={ring}>
                    {title}
                  </span>
                  <progress
                    className="token-usage-bar [&::-webkit-progress-bar]:bg-line [&::-webkit-progress-value]:[background:var(--token-color)] [&::-moz-progress-bar]:[background:var(--token-color)] appearance-none w-full h-[6px] overflow-hidden border-0 rounded-[3px] bg-line"
                    aria-label={`${label} · ${title} · ${ring}`}
                    max={usage[key]?.limit ?? 1}
                    value={usage[key] ? Math.min(usage[key].used, usage[key].limit) : undefined}
                    aria-valuetext={usageText(usage[key])}
                  />
                  <span className="token-usage-count tabular-nums text-foreground">
                    {usageText(usage[key])}
                  </span>
                </Grid>
              ))}
              {status && (
                <p className="token-usage-status [margin:8px_0_0] wrap-anywhere">{status}</p>
              )}
            </Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
