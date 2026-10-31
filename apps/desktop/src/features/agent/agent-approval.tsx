import { Button } from "@/shared/ui";
import { t } from "@/shared/i18n";
import { QuoteSummary } from "@/features/generation/submission/quote-summary";
import { ParameterDiagnostics } from "@/features/generation/submission/parameter-diagnostics";
import type { AgentController } from "./use-agent";

/** Approval describes the frozen submission, rather than whatever the editor currently displays. */
export function AgentApprovalCard({
  agent,
  readOnly,
}: {
  agent: AgentController;
  readOnly: boolean;
}) {
  const request = agent.snapshot?.approval;
  if (!request) return null;
  const { quote } = request;
  const resolved = quote.resolved;
  return (
    <section className="agent-approval" aria-label={t("agent.approvalTitle")}>
      <strong>{t("agent.approvalTitle")}</strong>
      <p>{t("agent.approvalAccount", { name: request.accountName })}</p>
      {resolved && (
        <>
          <p>
            {resolved.settings.model} · {resolved.settings.size.width} ×{" "}
            {resolved.settings.size.height} ·{" "}
            {t("agent.approvalCount", { requests: quote.requestCount, images: quote.totalSamples })}
          </p>
          <details>
            <summary>{t("agent.approvalDetails")}</summary>
            <p>{resolved.positive}</p>
            <p>
              {t("agent.negativePrompt")}: {resolved.negative}
            </p>
            <p>
              {resolved.settings.sampler} · {resolved.settings.steps} steps · CFG{" "}
              {resolved.settings.scale}
            </p>
            {resolved.characters
              .filter((character) => character.enabled)
              .map((character) => (
                <p key={character.id}>
                  {character.positive}
                  <br />
                  {character.negative}
                </p>
              ))}
          </details>
        </>
      )}
      <QuoteSummary quote={quote} />
      <ParameterDiagnostics diagnostics={quote.diagnostics} />
      <p className="agent-help">{t("agent.approvalHelp")}</p>
      <div className="button-group">
        <Button
          disabled={readOnly || agent.approvalBusy || agent.cancelling}
          onClick={() => void agent.approve(request.id, false)}
        >
          {t("agent.reject")}
        </Button>
        <Button
          className="primary"
          disabled={readOnly || agent.approvalBusy || agent.cancelling}
          onClick={() => void agent.approve(request.id, true)}
        >
          {t("agent.approve")}
        </Button>
      </div>
    </section>
  );
}
