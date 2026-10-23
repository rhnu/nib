import type { GenerationQuote } from "../../../bindings/generation";
import { HelpMarker } from "../../../shared/ui";

export function QuoteHelp() {
  return (
    <HelpMarker label="费用估算说明">
      SDK 使用最近显式读取的账户信息估算；没有账户快照时使用非订阅条件。估算不代表实际扣费。
    </HelpMarker>
  );
}

export function QuoteSummary({ quote }: { quote: GenerationQuote }) {
  return (
    <span className="generation-estimate">
      <span>
        {quote.estimatedAnlas === null ? (
          <strong>费用未知</strong>
        ) : (
          <>
            <strong>{quote.estimatedAnlas}</strong> Anlas
          </>
        )}
      </span>
      <QuoteHelp />
      {quote.tooExpensive && <span className="generation-danger">超出费用限制</span>}
    </span>
  );
}
