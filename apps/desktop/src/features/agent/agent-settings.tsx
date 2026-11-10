import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Plus } from "lucide-react";
import type { McpServerStatus, SkillConfig } from "@/bindings/agent";
import {
  ActionsMenu,
  Button,
  Col,
  HelpMarker,
  Modal,
  Notice,
  Row,
  SettingsGroup,
  SettingRow,
  Toggle,
  notify,
} from "@/shared/ui";
import { errorMessage } from "@/shared/host/error";
import { t } from "@/shared/i18n";
import { agentApi } from "./api";
import { AgentConnection } from "./agent-connection";
import { AgentSystemPromptSettings } from "./agent-system-prompt-settings";
import { useAgentSettings } from "./use-agent-settings";
import { McpServerDialog } from "./mcp-server-dialog";
import { SkillViewer } from "./skill-viewer";

/** Configuration lists own their transactions; editing dialogs preserve drafts on failure. */
export function AgentSettings({ visible }: { visible: boolean }) {
  const settings = useAgentSettings();
  const client = useQueryClient();
  const servers = useQuery({ queryKey: ["agent-mcp"], queryFn: agentApi.mcpServers });
  const skills = useQuery({ queryKey: ["agent-skills"], queryFn: agentApi.skills });
  const catalog = useQuery({ queryKey: ["agent-skill-catalog"], queryFn: agentApi.skillCatalog });
  const [editing, setEditing] = useState<McpServerStatus | "new" | null>(null);
  const [viewing, setViewing] = useState<SkillConfig | null>(null);
  const [removing, setRemoving] = useState<{
    kind: "mcp" | "skill";
    id: string;
    name: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  const transact = async (action: () => Promise<void>) => {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    try {
      await action();
      return true;
    } catch (cause) {
      notify(() => errorMessage(cause), "agent-extension-error", true);
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const updateSkills = async (action: () => ReturnType<typeof agentApi.skills>) => {
    client.setQueryData(["agent-skills"], await action());
    await client.invalidateQueries({ queryKey: ["agent-skill-catalog"] });
  };

  const addSkill = () =>
    transact(async () => {
      const directory = await open({
        directory: true,
        multiple: false,
        title: t("agent.chooseSkillDirectory"),
      });
      if (directory)
        await updateSkills(() => agentApi.saveSkill({ id: "", directory, enabled: true }));
    });

  return (
    <Col gap={6}>
      {settings.error && (
        <Notice
          actions={<Button onClick={() => void settings.refresh()}>{t("app.reload")}</Button>}
        >
          {errorMessage(settings.error)}
        </Notice>
      )}
      <AgentConnection
        agent={settings}
        disabled={settings.loading || settings.connectionBusy}
        open={visible}
        visible
      />
      <AgentSystemPromptSettings />
      <SettingsGroup
        title={
          <>
            {t("agent.mcpServers")}
            <HelpMarker label={t("agent.mcpServers")}>{t("agent.mcpHelp")}</HelpMarker>
          </>
        }
        actions={
          <Button
            disabled={busy || servers.isPending || Boolean(servers.error)}
            onClick={() => setEditing("new")}
          >
            <Plus size={14} aria-hidden />
            {t("agent.addServer")}
          </Button>
        }
      >
        {servers.isPending ? (
          <span className="text-muted">{t("agent.loadingSettings")}</span>
        ) : servers.error ? (
          <Notice
            actions={<Button onClick={() => void servers.refetch()}>{t("app.reload")}</Button>}
          >
            {errorMessage(servers.error)}
          </Notice>
        ) : !servers.data?.length ? (
          <p className="m-0 text-muted">{t("agent.noServers")}</p>
        ) : (
          servers.data.map((server) => (
            <SettingRow
              key={server.config.id}
              label={server.config.name}
              description={
                server.config.transport.kind === "http"
                  ? server.config.transport.url
                  : server.config.transport.command
              }
              controlWidth="auto"
              className="py-space-3"
            >
              <Toggle
                label={t("agent.enableServer", { name: server.config.name })}
                checked={server.config.enabled}
                disabled={busy}
                onChange={(enabled) =>
                  void transact(async () => {
                    client.setQueryData(
                      ["agent-mcp"],
                      await agentApi.saveMcpServer({ ...server.config, enabled }, null),
                    );
                  })
                }
              />
              <ActionsMenu
                label={t("agent.serverActions", { name: server.config.name })}
                disabled={busy}
                items={[
                  { label: t("agent.edit"), action: () => setEditing(server) },
                  {
                    label: t("agent.testConnection"),
                    action: () =>
                      void transact(async () => {
                        const result = await agentApi.testMcpServer(server.config.id);
                        notify(() =>
                          t("agent.connectionTested", { count: result.toolNames.length }),
                        );
                      }),
                  },
                  { separator: true },
                  {
                    label: t("agent.remove"),
                    danger: true,
                    action: () =>
                      setRemoving({ kind: "mcp", id: server.config.id, name: server.config.name }),
                  },
                ]}
              />
            </SettingRow>
          ))
        )}
      </SettingsGroup>
      <SettingsGroup
        title={
          <>
            {t("agent.skills")}
            <HelpMarker label={t("agent.skills")}>{t("agent.skillsHelp")}</HelpMarker>
          </>
        }
        actions={
          <Button
            disabled={busy || skills.isPending || Boolean(skills.error)}
            onClick={() => void addSkill()}
          >
            <Plus size={14} aria-hidden />
            {t("agent.addSkill")}
          </Button>
        }
      >
        {skills.isPending ? (
          <span className="text-muted">{t("agent.loadingSettings")}</span>
        ) : skills.error ? (
          <Notice
            actions={<Button onClick={() => void skills.refetch()}>{t("app.reload")}</Button>}
          >
            {errorMessage(skills.error)}
          </Notice>
        ) : !skills.data?.length ? (
          <p className="m-0 text-muted">{t("agent.noSkills")}</p>
        ) : (
          skills.data.map((skill) => {
            const summary = catalog.data?.find((item) => item.id === skill.id);
            const name =
              summary?.name ??
              skill.directory.split(/[\\/]/).filter(Boolean).at(-1) ??
              skill.directory;
            return (
              <SettingRow
                key={skill.id}
                label={name}
                description={summary?.description || skill.directory}
                controlWidth="auto"
                className="py-space-3"
              >
                <Toggle
                  label={t("agent.enableSkill", { name })}
                  checked={skill.enabled}
                  disabled={busy}
                  onChange={(enabled) =>
                    void transact(() =>
                      updateSkills(() => agentApi.saveSkill({ ...skill, enabled })),
                    )
                  }
                />
                <ActionsMenu
                  label={t("agent.skillActions", { name })}
                  disabled={busy}
                  items={[
                    { label: t("agent.viewSkill"), action: () => setViewing(skill) },
                    { separator: true },
                    {
                      label: t("agent.remove"),
                      danger: true,
                      action: () => setRemoving({ kind: "skill", id: skill.id, name }),
                    },
                  ]}
                />
              </SettingRow>
            );
          })
        )}
        {catalog.error && (
          <Notice
            actions={<Button onClick={() => void catalog.refetch()}>{t("app.reload")}</Button>}
          >
            {errorMessage(catalog.error)}
          </Notice>
        )}
      </SettingsGroup>
      {editing && (
        <McpServerDialog
          server={editing === "new" ? null : editing}
          busy={busy}
          onClose={() => {
            if (!pending.current) setEditing(null);
          }}
          onSave={(config, secrets) =>
            transact(async () => {
              client.setQueryData(["agent-mcp"], await agentApi.saveMcpServer(config, secrets));
              setEditing(null);
            })
          }
        />
      )}
      {viewing && <SkillViewer skill={viewing} onClose={() => setViewing(null)} />}
      {removing && (
        <Modal
          open
          title={t("agent.removeTitle", { name: removing.name })}
          onClose={() => {
            if (!pending.current) setRemoving(null);
          }}
        >
          <p>{t("agent.removeHelp")}</p>
          <Row justify="end" gap={3}>
            <Button disabled={busy} onClick={() => setRemoving(null)}>
              {t("app.cancel")}
            </Button>
            <Button
              disabled={busy}
              className="text-danger"
              onClick={() =>
                void transact(async () => {
                  if (removing.kind === "mcp")
                    client.setQueryData(["agent-mcp"], await agentApi.removeMcpServer(removing.id));
                  else await updateSkills(() => agentApi.removeSkill(removing.id));
                  setRemoving(null);
                })
              }
            >
              {t("agent.remove")}
            </Button>
          </Row>
        </Modal>
      )}
    </Col>
  );
}
