import { Row } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";
import type { TokenFieldUsage } from "@/bindings/generation";
import { tokenFieldLabel } from "@/features/prompt/output-details";

export function TokenUsageSummary({ tokens }: { tokens: TokenFieldUsage[] }) {
  useTranslation();

  if (tokens.length === 0) return null;
  return (
    <Row
      gap={0}
      align="stretch"
      className="generation-token-usage flex flex-wrap gap-y-space-1 gap-x-[10px] m-0 text-caption leading-[1.6] mt-[9px]"
      aria-label={t("generation.submittedTokenUsage")}
    >
      <span className="muted text-muted">{t("generation.effectivePromptTokens")}</span>
      {tokens.map((token) => (
        <span
          key={token.field}
          className={token.overLimit ? "generation-danger text-danger" : "muted text-muted"}
        >
          {tokenFieldLabel(token.field)} {token.used} / {token.limit}
          {token.overLimit && t("generation.overLimitSuffix")}
        </span>
      ))}
    </Row>
  );
}
