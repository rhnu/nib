import type {
  AgentConnectionConfig,
  AgentConnectionStatus,
  AgentSnapshot,
  AgentSession,
  McpServerConfig,
  McpServerStatus,
  McpSecrets,
  McpConnectionTest,
  SkillConfig,
  SkillDocument,
  SkillSummary,
  AgentPermission,
  AgentProvider,
} from "@/bindings/agent";
import type { DraftSnapshot } from "@/bindings/workbench";
import { invokeHost } from "@/shared/host/invoke";

/** Secrets only cross the connection command and are never part of query or conversation state. */
export const agentApi = {
  connection: () => invokeHost<AgentConnectionStatus>("get_agent_connection"),
  saveConnection: (config: AgentConnectionConfig, apiKey: string | null) =>
    invokeHost<AgentConnectionStatus>("save_agent_connection", { config, apiKey }),
  mcpServers: () => invokeHost<McpServerStatus[]>("agent_mcp_servers"),
  saveMcpServer: (config: McpServerConfig, secrets: McpSecrets | null) =>
    invokeHost<McpServerStatus[]>("agent_save_mcp_server", { config, secrets }),
  removeMcpServer: (id: string) => invokeHost<McpServerStatus[]>("agent_remove_mcp_server", { id }),
  testMcpServer: (id: string) => invokeHost<McpConnectionTest>("agent_test_mcp_server", { id }),
  skills: () => invokeHost<SkillConfig[]>("agent_skills"),
  saveSkill: (config: SkillConfig) => invokeHost<SkillConfig[]>("agent_save_skill", { config }),
  removeSkill: (id: string) => invokeHost<SkillConfig[]>("agent_remove_skill", { id }),
  readSkill: (id: string, path: string | null = null) =>
    invokeHost<SkillDocument>("agent_read_skill", { id, path }),
  skillCatalog: () => invokeHost<SkillSummary[]>("agent_skill_catalog"),
  state: () => invokeHost<AgentSnapshot>("get_agent_state"),
  models: (provider: AgentProvider, apiKey: string | null) =>
    invokeHost<string[]>("list_agent_models", { provider, apiKey }),
  permission: (permission: AgentPermission) =>
    invokeHost<AgentConnectionStatus>("save_agent_permission", { permission }),
  approve: (id: string, allow: boolean) =>
    invokeHost<AgentSnapshot>("approve_agent_generation", { id, allow }),
  start: (prompt: string, assetIds: string[], expectedEpoch: string, expectedSessionId: string) =>
    invokeHost<AgentSnapshot>("start_agent_run", {
      prompt,
      assetIds,
      expectedEpoch,
      expectedSessionId,
    }),
  cancel: () => invokeHost<AgentSnapshot>("cancel_agent_run"),
  sessions: () => invokeHost<AgentSession[]>("list_agent_sessions"),
  newSession: () => invokeHost<AgentSnapshot>("new_agent_session"),
  selectSession: (id: string) => invokeHost<AgentSnapshot>("select_agent_session", { id }),
  deleteSession: (id: string) => invokeHost<AgentSnapshot>("delete_agent_session", { id }),
  undo: (expectedEpoch: string) => invokeHost<DraftSnapshot>("undo_agent_edit", { expectedEpoch }),
  undoResources: () => invokeHost<AgentSnapshot>("undo_agent_resources"),
};
