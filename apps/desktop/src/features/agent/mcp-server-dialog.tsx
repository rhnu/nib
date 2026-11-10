import { useState } from "react";
import type { McpSecrets, McpServerConfig, McpServerStatus } from "@/bindings/agent";
import {
  Button,
  Field,
  Grid,
  HelpMarker,
  Input,
  Modal,
  Row,
  Select,
  Textarea,
  Toggle,
  notify,
} from "@/shared/ui";
import { t } from "@/shared/i18n";
import { errorMessage } from "@/shared/host/error";

/** Parse explicit key/value lines without interpreting shell syntax. */
function entries(value: string) {
  return Object.fromEntries(
    value
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => {
        const equal = line.indexOf("=");
        if (equal < 1) throw new Error(t("agent.invalidKeyValue"));
        return [line.slice(0, equal).trim(), line.slice(equal + 1)];
      }),
  );
}

export function McpServerDialog({
  server,
  busy,
  onClose,
  onSave,
}: {
  server: McpServerStatus | null;
  busy: boolean;
  onClose: () => void;
  onSave: (config: McpServerConfig, secrets: McpSecrets | null) => Promise<boolean>;
}) {
  const [config, setConfig] = useState<McpServerConfig>(
    () =>
      server?.config ?? {
        id: "",
        name: "",
        enabled: true,
        transport: { kind: "http", url: "" },
        connectionTimeoutMs: 10000,
        callTimeoutMs: 60000,
      },
  );
  const [httpUrl, setHttpUrl] = useState(
    server?.config.transport.kind === "http" ? server.config.transport.url : "",
  );
  const [command, setCommand] = useState(
    server?.config.transport.kind === "stdio" ? server.config.transport.command : "",
  );
  const [args, setArgs] = useState(
    server?.config.transport.kind === "stdio" ? server.config.transport.args.join("\n") : "",
  );
  const [cwd, setCwd] = useState(
    server?.config.transport.kind === "stdio" ? (server.config.transport.cwd ?? "") : "",
  );
  const [clearSecrets, setClearSecrets] = useState(false);
  const [bearer, setBearer] = useState("");
  const [headers, setHeaders] = useState("");
  const [env, setEnv] = useState("");
  const transport = config.transport.kind;
  return (
    <Modal
      open
      title={t(server ? "agent.editServer" : "agent.addServer")}
      onClose={busy ? () => {} : onClose}
      showClose={!busy}
      className="w-[min(600px,calc(100vw-32px))]"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          try {
            const bearerToken = transport === "http" ? bearer.trim() || null : null;
            const headerValues = transport === "http" && !clearSecrets ? entries(headers) : {};
            const envValues = transport === "stdio" && !clearSecrets ? entries(env) : {};
            const secrets: McpSecrets | null = clearSecrets
              ? { bearerToken: null, headers: {}, env: {} }
              : bearerToken || Object.keys(headerValues).length || Object.keys(envValues).length
                ? { bearerToken, headers: headerValues, env: envValues }
                : null;
            void onSave(
              {
                ...config,
                name: config.name.trim(),
                transport:
                  transport === "http"
                    ? { kind: "http", url: httpUrl.trim() }
                    : {
                        kind: "stdio",
                        command: command.trim(),
                        args: args.split(/\r?\n/).filter((line) => line.length > 0),
                        cwd: cwd.trim() || null,
                      },
              },
              secrets,
            );
          } catch (cause) {
            notify(() => errorMessage(cause), "agent-mcp-validation", true);
          }
        }}
      >
        <Grid
          as="fieldset"
          disabled={busy}
          columns={2}
          gap={4}
          className="border-0 m-0 p-0 min-w-0 max-[560px]:grid-cols-1"
        >
          <Field label={t("agent.serverName")} required>
            <Input
              required
              value={config.name}
              onChange={(event) => setConfig({ ...config, name: event.target.value })}
            />
          </Field>
          <Field label={t("agent.transport")}>
            <Select
              value={transport}
              options={[
                { value: "http", label: "HTTPS" },
                { value: "stdio", label: "stdio" },
              ]}
              onValueChange={(kind) =>
                setConfig({
                  ...config,
                  transport:
                    kind === "http"
                      ? { kind: "http", url: httpUrl }
                      : { kind: "stdio", command, args: [], cwd: null },
                })
              }
            />
          </Field>
          {transport === "http" ? (
            <>
              <Field className="col-span-full" label={t("agent.serverUrl")} required>
                <Input
                  type="url"
                  required
                  value={httpUrl}
                  onChange={(event) => setHttpUrl(event.target.value)}
                  placeholder="https://example.com/mcp"
                />
              </Field>
              <Field
                className="col-span-full"
                label={t("agent.bearerToken")}
                help={
                  <HelpMarker label={t("agent.bearerToken")}>
                    {t("agent.mcpSecretsHelp")}
                  </HelpMarker>
                }
              >
                <Input
                  value={bearer}
                  onChange={(event) => setBearer(event.target.value)}
                  disabled={clearSecrets}
                  type="password"
                  autoComplete="new-password"
                />
              </Field>
              <Field
                className="col-span-full"
                label={t("agent.headers")}
                help={<HelpMarker label={t("agent.headers")}>{t("agent.keyValueHelp")}</HelpMarker>}
              >
                <Textarea
                  value={headers}
                  onChange={(event) => setHeaders(event.target.value)}
                  disabled={clearSecrets}
                  autoComplete="off"
                  rows={3}
                  spellCheck={false}
                />
              </Field>
            </>
          ) : (
            <>
              <Field
                className="col-span-full"
                label={t("agent.command")}
                required
                help={<HelpMarker label={t("agent.command")}>{t("agent.commandHelp")}</HelpMarker>}
              >
                <Input
                  required
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  spellCheck={false}
                />
              </Field>
              <Field
                label={t("agent.arguments")}
                help={
                  <HelpMarker label={t("agent.arguments")}>{t("agent.argumentsHelp")}</HelpMarker>
                }
              >
                <Textarea
                  value={args}
                  onChange={(event) => setArgs(event.target.value)}
                  rows={3}
                  spellCheck={false}
                />
              </Field>
              <Field
                label={t("agent.environment")}
                help={
                  <HelpMarker label={t("agent.environment")}>
                    {t("agent.keyValueHelp")} {t("agent.mcpSecretsHelp")}
                  </HelpMarker>
                }
              >
                <Textarea
                  value={env}
                  onChange={(event) => setEnv(event.target.value)}
                  disabled={clearSecrets}
                  autoComplete="off"
                  rows={3}
                  spellCheck={false}
                />
              </Field>
              <Field className="col-span-full" label={t("agent.workingDirectory")}>
                <Input
                  value={cwd}
                  onChange={(event) => setCwd(event.target.value)}
                  spellCheck={false}
                />
              </Field>
            </>
          )}
          <Field label={t("agent.connectionTimeout")}>
            <Input
              type="number"
              min={100}
              max={600000}
              required
              value={config.connectionTimeoutMs}
              onChange={(event) =>
                setConfig({ ...config, connectionTimeoutMs: Number(event.target.value) })
              }
            />
          </Field>
          <Field label={t("agent.callTimeout")}>
            <Input
              type="number"
              min={100}
              max={3600000}
              required
              value={config.callTimeoutMs}
              onChange={(event) =>
                setConfig({ ...config, callTimeoutMs: Number(event.target.value) })
              }
            />
          </Field>
          {server?.hasSecrets && (
            <Row className="col-span-full" gap={3}>
              <Toggle
                label={t("agent.clearSecrets")}
                checked={clearSecrets}
                onChange={setClearSecrets}
              />
              <span>{t("agent.clearSecrets")}</span>
            </Row>
          )}
          <Row justify="end" gap={3} className="col-span-full">
            <Button onClick={onClose}>{t("app.cancel")}</Button>
            <Button type="submit" variant="primary">
              {t(busy ? "agent.saving" : "agent.save")}
            </Button>
          </Row>
        </Grid>
      </form>
    </Modal>
  );
}
