import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Button, Field, Modal, Notice, Row, SettingsGroup, Textarea, notify } from "@/shared/ui";
import { errorMessage } from "@/shared/host/error";
import { t } from "@/shared/i18n";
import { agentApi } from "./api";

const queryKey = ["agent-system-prompt"] as const;

/** Keep unsaved edits separate from the built-in prompt and the persisted override. */
export function AgentSystemPromptSettings() {
  const client = useQueryClient();
  const prompt = useQuery({ queryKey, queryFn: agentApi.systemPrompt, retry: false });
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const pending = useRef(false);
  const stored = prompt.data;
  const effective = stored?.customPrompt ?? stored?.builtIn ?? "";
  const value = draft ?? effective;
  const dirty = draft !== null && value !== effective;

  const save = async (customPrompt: string | null) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await client.cancelQueries({ queryKey });
      const next = await agentApi.saveSystemPrompt(customPrompt);
      await client.cancelQueries({ queryKey });
      client.setQueryData(queryKey, next);
      setDraft(null);
      setResetting(false);
      notify(() =>
        t(customPrompt === null ? "agent.systemPromptReset" : "agent.systemPromptSaved"),
      );
    } catch (cause) {
      notify(() => errorMessage(cause), "agent-system-prompt-error", true);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <SettingsGroup title={t("agent.systemPrompt")} description={t("agent.systemPromptHelp")}>
      {prompt.error && (
        <Notice actions={<Button onClick={() => void prompt.refetch()}>{t("app.reload")}</Button>}>
          {errorMessage(prompt.error)}
        </Notice>
      )}
      {prompt.isPending ? (
        <span className="text-muted">{t("agent.loadingSettings")}</span>
      ) : stored ? (
        <>
          <output className="m-0 text-label text-muted">
            {t(
              stored.customPrompt === null
                ? "agent.systemPromptBuiltIn"
                : "agent.systemPromptCustom",
            )}
          </output>
          {stored.builtInChanged && <Notice>{t("agent.systemPromptUpdated")}</Notice>}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (dirty && value.trim() && !pending.current) void save(value);
            }}
          >
            <Field
              label={t("agent.systemPromptContent")}
              error={dirty && !value.trim() ? t("agent.systemPromptEmpty") : undefined}
            >
              <Textarea
                value={value}
                onChange={(event) => setDraft(event.target.value)}
                disabled={busy}
                rows={10}
                spellCheck={false}
              />
            </Field>
            <Row gap={3} justify="end" wrap className="mt-space-3">
              <Button
                disabled={busy || (stored.customPrompt === null && !dirty)}
                onClick={() => setResetting(true)}
              >
                {t("agent.resetSystemPrompt")}
              </Button>
              <Button type="submit" disabled={busy || !dirty || !value.trim()}>
                {t(busy ? "agent.saving" : "agent.saveSystemPrompt")}
              </Button>
            </Row>
          </form>
          <details>
            <summary className="cursor-pointer text-label">{t("agent.viewBuiltInPrompt")}</summary>
            <pre className="m-0 mt-space-3 max-h-[40vh] overflow-auto whitespace-pre-wrap break-words text-body select-text">
              {stored.builtIn}
            </pre>
          </details>
        </>
      ) : null}
      {resetting && (
        <Modal
          open
          title={t("agent.resetSystemPrompt")}
          onClose={() => {
            if (!pending.current) setResetting(false);
          }}
        >
          <p>{t("agent.resetSystemPromptHelp")}</p>
          <Row gap={3} justify="end" wrap>
            <Button disabled={busy} onClick={() => setResetting(false)}>
              {t("app.cancel")}
            </Button>
            <Button disabled={busy} onClick={() => void save(null)}>
              {t("agent.resetSystemPrompt")}
            </Button>
          </Row>
        </Modal>
      )}
    </SettingsGroup>
  );
}
