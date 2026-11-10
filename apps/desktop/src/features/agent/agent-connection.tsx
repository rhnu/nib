import {
  AutocompleteInput,
  Button,
  Field,
  InputRow,
  Grid,
  IconButton,
  Select,
  Input,
  SettingsGroup,
  HelpMarker,
} from "@/shared/ui";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type {
  AgentApi,
  AgentConnectionConfig,
  AgentPermission,
  AgentProvider,
} from "@/bindings/agent";

import { errorMessage } from "@/shared/host/error";
import { t } from "@/shared/i18n";
import { agentApi } from "./api";
import type { AgentSettingsController } from "./use-agent-settings";

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
  agent: AgentSettingsController;
  disabled: boolean;
  open: boolean;
  visible: boolean;
}) {
  const [editedConfig, setConfig] = useState<AgentConnectionConfig | null>(null);
  const config = editedConfig ??
    agent.connection?.config ?? { model: "", provider: { kind: "openAi" } };

  const [discovery, setDiscovery] = useState<{
    key: string;
    models: string[];
    error: unknown;
    loading: boolean;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const [customDraft, setCustomDraft] = useState<Extract<AgentProvider, { kind: "custom" }> | null>(
    null,
  );
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
    setConfig(next);
  };

  return (
    <form
      id="agent-connection"
      className="agent-connection"
      hidden={!visible}
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || agent.connectionBusy) return;
        const key = password.current?.value.trim() || null;
        void agent
          .saveConnection({ ...config, model: config.model.trim() }, key)
          .then((success) => {
            if (success) {
              if (password.current) password.current.value = "";
              setConfig(null);
              setRevision((value) => value + 1);
            }
          });
      }}
    >
      <SettingsGroup
        title={t("agent.modelPermissions")}
        actions={
          <Button type="submit" disabled={disabled || agent.connectionBusy}>
            {t(agent.connectionBusy ? "agent.saving" : "agent.saveConnection")}
          </Button>
        }
      >
        <Grid
          align="stretch"
          as="fieldset"
          columns={2}
          gap={4}
          className="m-0 min-w-0 border-0 p-0 max-[700px]:grid-cols-1"
          disabled={disabled || agent.connectionBusy}
        >
          <Field label={t("agent.provider")}>
            <Select
              value={provider.kind}
              options={[
                ...presets.map(({ id, label }) => ({ value: id, label })),
                { value: "custom", label: t("agent.customProvider") },
              ]}
              onValueChange={(id) => {
                if (provider.kind === "custom") setCustomDraft(provider);
                const next: AgentProvider =
                  id === "custom"
                    ? (customDraft ??
                      (storedProvider?.kind === "custom"
                        ? storedProvider
                        : { kind: "custom", endpoint: "", api: "responses" }))
                    : { kind: id as "openAi" | "deepSeek" | "openRouter" };
                change({ ...config, provider: next });
                if (password.current) password.current.value = "";
              }}
            />
          </Field>
          {provider.kind === "custom" && (
            <>
              <Field
                required
                label={t("agent.endpoint")}
                help={
                  <HelpMarker label={t("agent.endpoint")}>{t("agent.endpointHelp")}</HelpMarker>
                }
              >
                <Input
                  autoComplete="off"
                  type="url"

                  value={provider.endpoint}
                  placeholder="https://api.openai.com/v1"
                  onChange={(event) => {
                    if (password.current) password.current.value = "";
                    change({ ...config, provider: { ...provider, endpoint: event.target.value } });
                  }}
                />
              </Field>
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
          <Field
            required={!agent.connection?.configured || !sameDestination}
            label={t("agent.apiKey")}
            help={
              <HelpMarker label={t("agent.apiKey")}>
                {t(
                  agent.connection?.configured && sameDestination
                    ? "agent.keyStored"
                    : "agent.keyRequired",
                )}
              </HelpMarker>
            }
          >
            <Input
              ref={password}
              type="password"
              autoComplete="new-password"
              onChange={() => setRevision((value) => value + 1)}

              onBlur={() => setRevision((value) => value + 1)}
            />
          </Field>
          <Field
            required
            label={t("agent.model")}
            htmlFor="agent-model"
            help={<HelpMarker label={t("agent.model")}>{t("agent.modelHelp")}</HelpMarker>}
            error={
              modelError !== null ? (
                <>
                  {t("agent.modelsFailed")} {errorMessage(modelError)}
                </>
              ) : undefined
            }
          >
            <InputRow>
              <AutocompleteInput
                id="agent-model"

                disabled={disabled || agent.connectionBusy}
                suggestions={models}
                value={config.model}
                onValueChange={(model) => change({ ...config, model })}
                aria-label={t("agent.model")}
              />
              <IconButton
                label={t("agent.refreshModels")}
                disabled={loading || (provider.kind === "custom" && !provider.endpoint.trim())}
                onClick={() => setRevision((value) => value + 1)}
              >
                <RefreshCw size={14} className={loading ? "spin" : undefined} aria-hidden />
              </IconButton>
            </InputRow>
          </Field>
          <Field
            label={t("agent.generationPermission")}
            help={
              <HelpMarker label={t("agent.generationPermission")}>
                {t("agent.permissionHelp")}
              </HelpMarker>
            }
          >
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
        </Grid>
      </SettingsGroup>
    </form>
  );
}
