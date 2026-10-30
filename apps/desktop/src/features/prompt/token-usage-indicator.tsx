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
        className="icon-button token-usage-indicator"
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
              className={`token-scope-${key}${usage[key]?.overLimit ? " over-limit" : ""}`}
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
        <Popover.Positioner sideOffset={6} align="end" className="help-positioner">
          <Popover.Popup className="help-popup token-usage-popup" initialFocus={false}>
            <header>
              <Popover.Title>{label}</Popover.Title>
              <Popover.Close className="icon-button" aria-label={t("common.closeHelp")}>
                <X size={14} aria-hidden />
              </Popover.Close>
            </header>
            <Popover.Description render={<div />}>
              {scopes.map(({ key, title, ring }) => (
                <div
                  key={key}
                  className={`token-usage-row token-scope-${key}${usage[key]?.overLimit ? " over-limit" : ""}`}
                >
                  <span className="token-usage-label" title={ring}>
                    {title}
                  </span>
                  <progress
                    className="token-usage-bar"
                    aria-label={`${label} · ${title} · ${ring}`}
                    max={usage[key]?.limit ?? 1}
                    value={usage[key] ? Math.min(usage[key].used, usage[key].limit) : undefined}
                    aria-valuetext={usageText(usage[key])}
                  />
                  <span className="token-usage-count">{usageText(usage[key])}</span>
                </div>
              ))}
              {status && <p className="token-usage-status">{status}</p>}
            </Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
