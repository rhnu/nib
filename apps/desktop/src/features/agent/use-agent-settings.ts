import { useRef } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentConnectionConfig, AgentPermission } from "@/bindings/agent";
import { errorMessage } from "@/shared/host/error";
import { t } from "@/shared/i18n";
import { notify } from "@/shared/ui";
import { agentApi } from "./api";

const connectionKey = ["agent-connection"] as const;
const mutationKey = ["agent-settings"] as const;

/** Global configuration can be edited before the creative workspace is available. */
export function useAgentSettings() {
  const client = useQueryClient();
  const connection = useQuery({
    queryKey: connectionKey,
    queryFn: agentApi.connection,
    retry: false,
  });
  const busy = useIsMutating({ mutationKey }) > 0;
  // Keep write-only secrets out of React Query mutation variables and cached results.
  const pendingAction = useRef<(() => ReturnType<typeof agentApi.connection>) | null>(null);
  const save = useMutation({
    mutationKey,
    mutationFn: async () => {
      const action = pendingAction.current!;
      pendingAction.current = null;
      await client.cancelQueries({ queryKey: connectionKey });
      const next = await action();
      await client.cancelQueries({ queryKey: connectionKey });
      client.setQueryData(connectionKey, next);
      return next;
    },
    onError: (cause) => notify(() => errorMessage(cause), "agent-settings-error", true),
  });

  const saveConnection = async (config: AgentConnectionConfig, apiKey: string | null) => {
    if (client.isMutating({ mutationKey })) return false;
    try {
      pendingAction.current = () => agentApi.saveConnection(config, apiKey);
      await save.mutateAsync();
      notify(() => t("agent.connectionSaved"));
      return true;
    } catch {
      return false;
    }
  };

  const savePermission = async (permission: AgentPermission) => {
    if (client.isMutating({ mutationKey })) return;
    try {
      pendingAction.current = () => agentApi.permission(permission);
      await save.mutateAsync();
    } catch {
      /* The mutation reports the failure. */
    }
  };

  return {
    connection: connection.data ?? null,
    loading: connection.isPending,
    error: connection.error,
    refresh: connection.refetch,
    connectionBusy: busy,
    saveConnection,
    savePermission,
  };
}

export type AgentSettingsController = ReturnType<typeof useAgentSettings>;
