import { t, useTranslation } from "@/shared/i18n";
import type { GenerationQuote } from "@/bindings/generation";
import { HelpMarker } from "@/shared/ui";

export function QuoteHelp() {
  useTranslation();

  return (
    <HelpMarker label={t("generation.estimateHelpTitle")}>
      {t("generation.estimateHelp")}
    </HelpMarker>
  );
}

export function QuoteSummary({ quote }: { quote: GenerationQuote }) {
  useTranslation();

  return (
    <span className="generation-estimate">
      <span>
        {quote.estimatedAnlas === null ? (
          <strong>{t("generation.costUnknown")}</strong>
        ) : (
          <>
            <strong>{quote.estimatedAnlas}</strong>
            {t("generation.anlasSuffix")}
          </>
        )}
      </span>
      <QuoteHelp />
      {quote.tooExpensive && (
        <span className="generation-danger">{t("generation.costLimitExceeded")}</span>
      )}
    </span>
  );
}
