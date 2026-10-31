import type {
  AgentConnectionConfig,
  AgentConnectionStatus,
  AgentSnapshot,
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
  state: () => invokeHost<AgentSnapshot>("get_agent_state"),
  models: (provider: AgentProvider, apiKey: string | null) =>
    invokeHost<string[]>("list_agent_models", { provider, apiKey }),
  permission: (permission: AgentPermission) =>
    invokeHost<AgentConnectionStatus>("save_agent_permission", { permission }),
  approve: (id: string, allow: boolean) =>
    invokeHost<AgentSnapshot>("approve_agent_generation", { id, allow }),
  start: (prompt: string, assetIds: string[], expectedEpoch: string) =>
    invokeHost<AgentSnapshot>("start_agent_run", { prompt, assetIds, expectedEpoch }),
  cancel: () => invokeHost<AgentSnapshot>("cancel_agent_run"),
  clear: () => invokeHost<AgentSnapshot>("clear_agent_conversation"),
  undo: (expectedEpoch: string) => invokeHost<DraftSnapshot>("undo_agent_edit", { expectedEpoch }),
  undoResources: () => invokeHost<AgentSnapshot>("undo_agent_resources"),
};
