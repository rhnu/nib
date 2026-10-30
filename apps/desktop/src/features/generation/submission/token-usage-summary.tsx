import { t, useTranslation } from "@/shared/i18n";
import type { TokenFieldUsage } from "@/bindings/generation";
import { tokenFieldLabel } from "@/features/prompt/output-details";

export function TokenUsageSummary({ tokens }: { tokens: TokenFieldUsage[] }) {
  useTranslation();

  if (tokens.length === 0) return null;
  return (
    <div className="generation-token-usage" aria-label={t("generation.submittedTokenUsage")}>
      <span className="muted">{t("generation.effectivePromptTokens")}</span>
      {tokens.map((token) => (
        <span key={token.field} className={token.overLimit ? "generation-danger" : "muted"}>
          {tokenFieldLabel(token.field)} {token.used} / {token.limit}
          {token.overLimit && t("generation.overLimitSuffix")}
        </span>
      ))}
    </div>
  );
}
