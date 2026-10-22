import type { TokenFieldUsage } from "../../bindings/generation";

function tokenLabel(field: string): string {
  if (field === "prompt") return "正面";
  if (field === "negativePrompt") return "负面";
  return field;
}

export function TokenUsageSummary({ tokens }: { tokens: TokenFieldUsage[] }) {
  if (tokens.length === 0) return null;
  return (
    <div className="generation-token-usage" aria-label="实际提交文本的 Token 用量">
      <span className="muted">有效提示词 Token</span>
      {tokens.map((token) => (
        <span key={token.field} className={token.overLimit ? "generation-danger" : "muted"}>
          {tokenLabel(token.field)} {token.used} / {token.limit}
          {token.overLimit && " · 超限"}
        </span>
      ))}
    </div>
  );
}
