import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountStatus, GenerationResult, JobRecord } from "../../bindings/generation";
import { errorMessage } from "../../shared/host/error";
import { generationApi } from "./api";

export function useGenerationData() {
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [jobs, setJobs] = useState<JobRecord[] | null>(null);
  const [results, setResults] = useState<GenerationResult[] | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const active = useRef(false);
  const pending = useRef<Promise<void> | null>(null);
  const accountPending = useRef<Promise<void> | null>(null);
  const jobsRef = useRef<JobRecord[]>([]);
  const mutationRevision = useRef(0);
  const accountRevision = useRef(0);

  const refreshAccount = useCallback((): Promise<void> => {
    if (!active.current) return Promise.resolve();
    if (accountPending.current) return accountPending.current;
    setAccountLoading(true);
    const revision = accountRevision.current;
    const request = generationApi
      .account()
      .then(
        (value) => {
          if (!active.current || revision !== accountRevision.current) return;
          setAccount(value);
          setAccountError(null);
        },
        (error: unknown) => {
          if (active.current && revision === accountRevision.current)
            setAccountError(errorMessage(error));
        },
      )
      .finally(() => {
        accountPending.current = null;
        if (active.current) setAccountLoading(false);
      });
    accountPending.current = request;
    return request;
  }, []);

  const refresh = useCallback((): Promise<void> => {
    if (!active.current) return Promise.resolve();
    if (pending.current) return pending.current;
    setRefreshing(true);
    const revision = mutationRevision.current;
    const request = Promise.allSettled([generationApi.jobs(), generationApi.results()])
      .then(([nextJobs, nextResults]) => {
        if (!active.current || revision !== mutationRevision.current) return;
        const errors: string[] = [];
        if (nextJobs.status === "fulfilled") {
          jobsRef.current = nextJobs.value;
          setJobs(nextJobs.value);
        } else errors.push(`任务：${errorMessage(nextJobs.reason)}`);
        if (nextResults.status === "fulfilled") setResults(nextResults.value);
        else errors.push(`结果：${errorMessage(nextResults.reason)}`);
        setQueryError(errors.length ? errors.join("；") : null);
      })
      .finally(() => {
        pending.current = null;
        if (active.current) setRefreshing(false);
      });
    pending.current = request;
    return request;
  }, []);

  useEffect(() => {
    active.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void refreshAccount();
    const poll = async () => {
      await refresh();
      if (stopped) return;
      const busy = jobsRef.current.some(
        (job) => job.status === "queued" || job.status === "running",
      );
      timer = setTimeout(() => void poll(), busy ? 1500 : 10000);
    };
    void poll();
    return () => {
      stopped = true;
      active.current = false;
      clearTimeout(timer);
    };
  }, [refresh, refreshAccount]);

  const accountChanged = useCallback((value: AccountStatus) => {
    if (!active.current) return;
    accountRevision.current += 1;
    setAccount(value);
    setAccountError(null);
  }, []);

  const acceptJob = useCallback(
    (value: JobRecord) => {
      if (!active.current) return;
      mutationRevision.current += 1;
      const current = jobsRef.current;
      const next = current.some((job) => job.id === value.id)
        ? current.map((job) => (job.id === value.id ? value : job))
        : [value, ...current];
      jobsRef.current = next;
      setJobs(next);
      if (pending.current) void pending.current.then(() => refresh());
      else void refresh();
    },
    [refresh],
  );

  return {
    account,
    accountError,
    accountLoading,
    refreshAccount,
    accountChanged,
    jobs,
    results,
    queryError,
    refreshing,
    refresh,
    acceptJob,
  };
}
