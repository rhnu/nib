import { Button, ButtonGroup } from "@/shared/ui";

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
    <section
      className="agent-approval shrink-0 [max-height:40%] overflow-auto py-[10px] px-space-4 [border-top:1px_solid_var(--accent)] bg-panel text-label [&_p]:my-space-2 [&_p]:[overflow-wrap:anywhere] [&_p]:whitespace-pre-wrap [&_.button-group]:justify-end [&_.button-group]:mt-space-3"
      aria-label={t("agent.approvalTitle")}
    >
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
      <p className="agent-help m-0 text-muted text-label">{t("agent.approvalHelp")}</p>
      <ButtonGroup gap={1} className="button-group">
        <Button
          disabled={readOnly || agent.approvalBusy || agent.cancelling}
          onClick={() => void agent.approve(request.id, false)}
        >
          {t("agent.reject")}
        </Button>
        <Button
          variant="primary"
          disabled={readOnly || agent.approvalBusy || agent.cancelling}
          onClick={() => void agent.approve(request.id, true)}
        >
          {t("agent.approve")}
        </Button>
      </ButtonGroup>
    </section>
  );
}
