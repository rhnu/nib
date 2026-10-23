import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountStatus, AccountSummary } from "../../bindings/generation";
import { errorMessage } from "../../shared/host/error";
import { generationApi } from "./api";

/** Opening reads local state; only the explicit refresh samples the remote account. */
export function useAccountData(executionVersion = 0) {
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [accountSummary, setAccountSummary] = useState<AccountSummary | null>(null);
  const [accountSummaryError, setAccountSummaryError] = useState<string | null>(null);
  const [accountSummaryLoading, setAccountSummaryLoading] = useState(false);
  const [accountVersion, setAccountVersion] = useState(0);
  const active = useRef(false);
  const revision = useRef(0);
  const summaryRevision = useRef(0);
  const localPending = useRef<Promise<void> | null>(null);
  const summaryPending = useRef<Promise<void> | null>(null);
  const currentExecutionVersion = useRef(executionVersion);

  const refreshAccount = useCallback((): Promise<void> => {
    if (!active.current) return Promise.resolve();
    if (localPending.current) return localPending.current;
    const requestedRevision = revision.current;
    const requestedSummaryRevision = summaryRevision.current;
    setAccountLoading(true);
    const request = Promise.allSettled([generationApi.account(), generationApi.accountSummary()])
      .then(([status, summary]) => {
        if (!active.current || requestedRevision !== revision.current) return;
        if (status.status === "fulfilled") {
          setAccount(status.value);
          setAccountError(null);
        } else setAccountError(errorMessage(status.reason));
        if (requestedSummaryRevision !== summaryRevision.current) return;
        if (summary.status === "fulfilled") {
          setAccountSummary(summary.value);
          setAccountSummaryError(null);
          setAccountVersion((value) => value + 1);
        } else setAccountSummaryError(errorMessage(summary.reason));
      })
      .finally(() => {
        if (localPending.current === request) localPending.current = null;
        if (active.current && requestedRevision === revision.current) setAccountLoading(false);
      });
    localPending.current = request;
    return request;
  }, []);

  const refreshAccountSummary = useCallback((): Promise<void> => {
    if (!active.current || !account?.configured) return Promise.resolve();
    if (summaryPending.current) return summaryPending.current;
    const requestedRevision = revision.current;
    summaryRevision.current += 1;
    setAccountSummaryLoading(true);
    setAccountSummaryError(null);
    const request = generationApi
      .refreshAccountSummary()
      .then(
        (summary) => {
          if (!active.current || requestedRevision !== revision.current) return;
          setAccountSummary(summary);
          setAccountVersion((value) => value + 1);
        },
        (cause: unknown) => {
          if (active.current && requestedRevision === revision.current)
            setAccountSummaryError(errorMessage(cause));
        },
      )
      .finally(() => {
        if (summaryPending.current === request) summaryPending.current = null;
        if (active.current && requestedRevision === revision.current)
          setAccountSummaryLoading(false);
      });
    summaryPending.current = request;
    return request;
  }, [account?.configured]);

  const accountChanged = useCallback((value: AccountStatus) => {
    if (!active.current) return;
    revision.current += 1;
    summaryRevision.current += 1;
    localPending.current = null;
    summaryPending.current = null;
    setAccount(value);
    setAccountError(null);
    setAccountLoading(false);
    setAccountSummary(null);
    setAccountSummaryError(null);
    setAccountSummaryLoading(false);
    setAccountVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    active.current = true;
    void refreshAccount();
    return () => {
      active.current = false;
      revision.current += 1;
      localPending.current = null;
      summaryPending.current = null;
    };
  }, [refreshAccount]);

  useEffect(() => {
    if (executionVersion === currentExecutionVersion.current) return;
    currentExecutionVersion.current = executionVersion;
    revision.current += 1;
    summaryRevision.current += 1;
    localPending.current = null;
    summaryPending.current = null;
    setAccountSummary(null);
    setAccountSummaryError(null);
    setAccountSummaryLoading(false);
    setAccountVersion((value) => value + 1);
    void refreshAccount();
  }, [executionVersion, refreshAccount]);

  return {
    account,
    accountError,
    accountLoading,
    refreshAccount,
    accountChanged,
    accountSummary,
    accountSummaryError,
    accountSummaryLoading,
    refreshAccountSummary,
    accountVersion,
  };
}
