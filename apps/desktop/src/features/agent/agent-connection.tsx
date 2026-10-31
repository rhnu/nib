import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type {
  AgentApi,
  AgentConnectionConfig,
  AgentPermission,
  AgentProvider,
} from "@/bindings/agent";
import { Button, Field, IconButton, Select } from "@/shared/ui";
import { errorMessage } from "@/shared/host/error";
import { t } from "@/shared/i18n";
import { agentApi } from "./api";
import type { AgentController } from "./use-agent";

const presets = [
  { id: "openAi", label: "OpenAI" },
  { id: "deepSeek", label: "DeepSeek" },
  { id: "openRouter", label: "OpenRouter" },
] as const;

/** Official connection details belong to the backend; discovery never replaces a typed model. */
export function AgentConnection({
  agent,
  disabled,
  open,
  visible,
}: {
  agent: AgentController;
  disabled: boolean;
  open: boolean;
  visible: boolean;
}) {
  const [editedConfig, setConfig] = useState<AgentConnectionConfig | null>(null);
  const config = editedConfig ??
    agent.connection?.config ?? { model: "", provider: { kind: "openAi" } };
  const [saved, setSaved] = useState(false);
  const [discovery, setDiscovery] = useState<{
    key: string;
    models: string[];
    error: unknown;
    loading: boolean;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const password = useRef<HTMLInputElement>(null);
  const provider = config.provider;
  const storedProvider = agent.connection?.config?.provider;
  const sameDestination =
    provider.kind === storedProvider?.kind &&
    (provider.kind !== "custom" ||
      (storedProvider.kind === "custom" &&
        provider.endpoint.trim().replace(/\/+$/, "") === storedProvider.endpoint));
  const providerKey = JSON.stringify(provider);
  const discoveryKey = `${providerKey}:${revision}:${agent.connection?.configured}:${open}:${visible}:${disabled}`;
  const currentDiscovery = discovery?.key === discoveryKey ? discovery : null;
  const models = currentDiscovery?.models ?? [];
  const modelError = currentDiscovery?.error ?? null;
  const loading = currentDiscovery?.loading ?? false;

  useEffect(() => {
    if ((!open || !visible) && password.current) password.current.value = "";
  }, [open, visible]);

  useEffect(() => {
    if (!open || !visible || disabled) return;
    const target: AgentProvider = JSON.parse(providerKey);
    if (target.kind === "custom" && !target.endpoint.trim()) return;
    let current = true;
    const timer = setTimeout(() => {
      const key = password.current?.value.trim() || null;
      if (!key && (!agent.connection?.configured || !sameDestination)) return;
      setDiscovery({ key: discoveryKey, models: [], error: null, loading: true });
      void agentApi.models(target, key).then(
        (value) => {
          if (current)
            setDiscovery({ key: discoveryKey, models: value, error: null, loading: false });
        },
        (cause: unknown) => {
          if (current)
            setDiscovery({ key: discoveryKey, models: [], error: cause, loading: false });
        },
      );
    }, 700);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [
    providerKey,
    sameDestination,
    agent.connection?.configured,
    discoveryKey,
    open,
    visible,
    disabled,
  ]);

  const change = (next: AgentConnectionConfig) => {
    setSaved(false);
    setConfig(next);
  };

  return (
    <form
      id="agent-connection"
      className="agent-connection"
      hidden={!visible}
      onSubmit={(event) => {
        event.preventDefault();
        const key = password.current?.value.trim() || null;
        if (password.current) password.current.value = "";
        setSaved(false);
        void agent
          .saveConnection({ ...config, model: config.model.trim() }, key)
          .then((success) => {
            setSaved(success);
            if (success) {
              setConfig(null);
              setRevision((value) => value + 1);
            }
          });
      }}
    >
      <fieldset disabled={disabled || agent.connectionBusy}>
        <legend>{t("agent.connection")}</legend>
        <Field label={t("agent.provider")}>
          <Select
            value={provider.kind}
            options={[
              ...presets.map(({ id, label }) => ({ value: id, label })),
              { value: "custom", label: t("agent.customProvider") },
            ]}
            onValueChange={(id) => {
              const next: AgentProvider =
                id === "custom"
                  ? { kind: "custom", endpoint: "", api: "responses" }
                  : { kind: id as "openAi" | "deepSeek" | "openRouter" };
              change({ ...config, provider: next });
              if (password.current) password.current.value = "";
            }}
          />
        </Field>
        {provider.kind === "custom" && (
          <>
            <Field label={t("agent.endpoint")}>
              <input
                type="url"
                required
                value={provider.endpoint}
                placeholder="https://api.openai.com/v1"
                onChange={(event) =>
                  change({ ...config, provider: { ...provider, endpoint: event.target.value } })
                }
                aria-describedby="agent-endpoint-help"
              />
            </Field>
            <p id="agent-endpoint-help" className="agent-help">
              {t("agent.endpointHelp")}
            </p>
            <Field label={t("agent.protocol")}>
              <Select
                value={provider.api}
                onValueChange={(api) =>
                  change({ ...config, provider: { ...provider, api: api as AgentApi } })
                }
                options={[
                  { value: "chatCompletions", label: t("agent.chatCompletions") },
                  { value: "responses", label: t("agent.responses") },
                ]}
              />
            </Field>
          </>
        )}
        <Field label={t("agent.apiKey")}>
          <input
            ref={password}
            type="password"
            autoComplete="new-password"
            required={!agent.connection?.configured || !sameDestination}
            aria-describedby="agent-key-help"
            onChange={() => {
              setSaved(false);
            }}
            onBlur={() => setRevision((value) => value + 1)}
          />
        </Field>
        <p id="agent-key-help" className="agent-help">
          {t(
            agent.connection?.configured && sameDestination
              ? "agent.keyStored"
              : "agent.keyRequired",
          )}
        </p>
        <Field label={t("agent.model")}>
          <div className="agent-model-input">
            <input
              required
              list="agent-models"
              value={config.model}
              onChange={(event) => change({ ...config, model: event.target.value })}
              aria-label={t("agent.model")}
              aria-describedby="agent-model-help"
            />
            <datalist id="agent-models">
              {models.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </datalist>
            <IconButton
              label={t("agent.refreshModels")}
              disabled={loading || (provider.kind === "custom" && !provider.endpoint.trim())}
              onClick={() => setRevision((value) => value + 1)}
            >
              <RefreshCw size={14} aria-hidden />
            </IconButton>
          </div>
        </Field>
        <p id="agent-model-help" className="agent-help" aria-live="polite">
          {t(loading ? "agent.loadingModels" : "agent.modelHelp")}
        </p>
        {modelError !== null && (
          <p className="agent-failure" role="alert">
            {t("agent.modelsFailed")} {errorMessage(modelError)}
          </p>
        )}
        <Field label={t("agent.generationPermission")}>
          <Select
            value={agent.connection?.generationPermission ?? "ask"}
            onValueChange={(value) => void agent.savePermission(value as AgentPermission)}
            options={[
              { value: "ask", label: t("agent.permissionAsk") },
              { value: "allow", label: t("agent.permissionAllow") },
              { value: "deny", label: t("agent.permissionDeny") },
            ]}
          />
        </Field>
        <p className="agent-help">{t("agent.permissionHelp")}</p>
        <div className="agent-connection-actions">
          {saved && <output>{t("agent.connectionSaved")}</output>}
          <Button type="submit" disabled={agent.connectionBusy}>
            {t("agent.saveConnection")}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
