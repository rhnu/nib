import type { GenerationQuote } from "../../bindings/generation";

export function QuoteSummary({ quote }: { quote: GenerationQuote }) {
  return (
    <span
      className="generation-estimate"
      title="SDK 按非订阅条件估算，未读取账户订阅和余额；实际扣费由 NovelAI 决定。"
    >
      SDK 预估 <strong>{quote.estimatedAnlas}</strong> Anlas
      <span className="generation-muted"> · 未查询订阅与余额</span>
      {quote.tooExpensive && <span className="generation-danger"> · 超出 SDK 费用限制</span>}
    </span>
  );
}
