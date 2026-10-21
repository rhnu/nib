import type { GenerationQuote } from "../../bindings/generation";
import { HelpMarker } from "../../shared/ui";

export function QuoteHelp() {
  return (
    <HelpMarker label="费用估算说明">
      SDK 按非订阅条件估算，未读取账户订阅和余额；实际扣费由 NovelAI 决定。
    </HelpMarker>
  );
}

export function QuoteSummary({ quote }: { quote: GenerationQuote }) {
  return (
    <span className="generation-estimate">
      <span>
        <strong>{quote.estimatedAnlas}</strong> Anlas
      </span>
      <QuoteHelp />
      {quote.tooExpensive && <span className="generation-danger">超出费用限制</span>}
    </span>
  );
}
