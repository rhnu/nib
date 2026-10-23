import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { GenerationResult, JobRecord } from "../../bindings/generation";
import type { Draft } from "../../bindings/workbench";
import { errorMessage } from "../../shared/host/error";
import { generationApi } from "./api";
import { useAccountData } from "./use-account-data";
import { useJobFeedback } from "./use-job-feedback";

export function useGenerationData(
  executionVersion = 0,
  beforeSubmit?: () => Promise<void>,
  submissionBlocked = false,
) {
  const account = useAccountData(executionVersion);
  const [jobs, setJobs] = useState<JobRecord[] | null>(null);
  const [results, setResults] = useState<GenerationResult[] | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const active = useRef(false);
  const pending = useRef<Promise<void> | null>(null);
  const jobsRef = useRef<JobRecord[]>([]);
  const mutationRevision = useRef(0);
  const lifetime = useRef(0);
  const beforeSubmitRef = useRef(beforeSubmit);
  useLayoutEffect(() => {
    beforeSubmitRef.current = beforeSubmit;
  }, [beforeSubmit]);
  const submit = useCallback(async (draft: Draft) => {
    await beforeSubmitRef.current?.();
    return generationApi.submit(draft);
  }, []);

  const refresh = useCallback((): Promise<void> => {
    if (!active.current) return Promise.resolve();
    if (pending.current) return pending.current;
    setRefreshing(true);
    const revision = mutationRevision.current;
    const requestedLifetime = lifetime.current;
    const request = Promise.allSettled([generationApi.jobs(), generationApi.results()])
      .then(([nextJobs, nextResults]) => {
        if (
          !active.current ||
          requestedLifetime !== lifetime.current ||
          revision !== mutationRevision.current
        )
          return;
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
        if (pending.current === request) pending.current = null;
        if (active.current && requestedLifetime === lifetime.current) setRefreshing(false);
      });
    pending.current = request;
    return request;
  }, []);

  useEffect(() => {
    active.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
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
      lifetime.current += 1;
      pending.current = null;
      clearTimeout(timer);
    };
  }, [refresh]);

  const feedback = useJobFeedback(jobs, refresh);
  const observedJobs = useMemo(
    () =>
      jobs?.map((job) =>
        feedback.jobObservations[job.id] && (job.status === "queued" || job.status === "running")
          ? { ...job, observation: feedback.jobObservations[job.id]! }
          : job,
      ) ?? null,
    [jobs, feedback.jobObservations],
  );

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
    ...account,
    ...feedback,
    jobs: observedJobs,
    results,
    queryError,
    refreshing,
    refresh,
    acceptJob,
    submit,
    submissionBlocked,
  };
}
