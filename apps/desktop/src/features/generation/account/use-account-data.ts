import { useCallback, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AccountStatus } from "../../../bindings/generation";
import { accountApi } from "./api";
import { errorMessage } from "../../../shared/host/error";
import { hasDesktopHost } from "../../../shared/host/invoke";

/** One provider observes host sampling; components share this query and its revision. */
export function useAccountData(executionVersion = 0) {
  const client = useQueryClient();
  const account = useQuery({
    queryKey: ["account-status"],
    queryFn: accountApi.account,
    enabled: hasDesktopHost(),
    retry: false,
  });
  const snapshot = useQuery({
    queryKey: ["account-snapshot"],
    queryFn: accountApi.accountSummary,
    enabled: hasDesktopHost(),
    refetchInterval: 2000,
    retry: false,
  });
  useEffect(() => {
    void client.invalidateQueries({ queryKey: ["account-snapshot"] });
  }, [client, executionVersion]);
  const accountChanged = useCallback(
    (value: AccountStatus) => {
      client.setQueryData(["account-status"], value);
      client.setQueryData(["account-snapshot"], {
        summary: null,
        refreshing: value.configured,
        stale: false,
        error: null,
        revision: (snapshot.data?.revision ?? 0) + 1,
      });
      void client.invalidateQueries({ queryKey: ["account-snapshot"] });
    },
    [client, snapshot.data?.revision],
  );
  const retry = useMutation({
    mutationFn: accountApi.refreshAccountSummary,
    onSuccess: (value) => {
      client.setQueryData(["account-snapshot"], value);
    },
  });
  const refreshAccountSummary = async () => {
    try {
      await retry.mutateAsync();
    } catch {
      /* The mutation error is rendered below. */
    }
  };
  return {
    account: account.data ?? null,
    accountError: account.error ? errorMessage(account.error) : null,
    accountLoading: account.isLoading,
    refreshAccount: async () => {
      await account.refetch();
    },
    accountChanged,
    accountSummary: snapshot.data?.summary ?? null,
    accountSummaryError:
      snapshot.data?.error ?? (snapshot.error ? errorMessage(snapshot.error) : null),
    accountSummaryLoading:
      snapshot.isLoading || retry.isPending || Boolean(snapshot.data?.refreshing),
    accountSummaryStale: Boolean(snapshot.data?.stale),
    refreshAccountSummary,
    accountVersion: (snapshot.data?.revision ?? 0) + executionVersion,
  };
}
