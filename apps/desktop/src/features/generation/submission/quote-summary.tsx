import { HelpMarker, Row } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";
import type { GenerationQuote } from "@/bindings/generation";

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
    <Row
      gap={0}
      as="span"
      className="generation-estimate [&_strong]:text-accent [&_strong]:tabular-nums inline-flex items-center flex-wrap gap-[5px]"
    >
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
        <span className="generation-danger text-danger">{t("generation.costLimitExceeded")}</span>
      )}
    </Row>
  );
}
