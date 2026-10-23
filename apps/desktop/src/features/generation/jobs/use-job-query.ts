import { useCallback, useEffect, useRef, useState } from "react";
import type { JobRecord, JobSummary, ResultSummary } from "../../../bindings/generation";
import { errorMessage } from "../../../shared/host/error";
import { jobsApi } from "./api";
import { resultsApi } from "../results/api";
import { mergeSummaries, reconcileJobs, summarizeJob } from "./summary";
import { refreshHistory } from "./paged-history";
import { recoverMissingJobs } from "./recover-missing-jobs";
const pageSize = 50;
/** Refresh the head and catch up newly inserted records; older history is loaded explicitly. */
export function useJobQuery() {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [results, setResults] = useState<ResultSummary[] | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [moreJobs, setMoreJobs] = useState(false);
  const [moreResults, setMoreResults] = useState(false);
  const [jobCursor, setJobCursor] = useState<string | null>(null);
  const [resultCursor, setResultCursor] = useState<string | null>(null);
  const active = useRef(false);
  const lifetime = useRef(0);
  const pending = useRef<Promise<void> | null>(null);
  const jobsRef = useRef<JobSummary[]>([]);
  const resultsRef = useRef<ResultSummary[] | null>(null);
  const jobPaging = useRef({ cursor: null as string | null, initialized: false, pending: false });
  const resultPaging = useRef({
    cursor: null as string | null,
    initialized: false,
    pending: false,
  });
  const mutationRevision = useRef(0);
  const refresh = useCallback((): Promise<void> => {
    if (!active.current) return Promise.resolve();
    if (pending.current) return pending.current;
    setRefreshing(true);
    const revision = mutationRevision.current;
    const requestedLifetime = lifetime.current;
    const isCurrent = () =>
      active.current &&
      requestedLifetime === lifetime.current &&
      revision === mutationRevision.current;
    const previousActive = jobsRef.current.filter(
      (job) => job.status === "queued" || job.status === "running",
    );
    const previousJobs = jobPaging.current.initialized
      ? {
          items: jobsRef.current.filter(
            (job) => job.status !== "queued" && job.status !== "running",
          ),
          nextCursor: jobPaging.current.cursor,
        }
      : null;
    const previousResults = resultPaging.current.initialized
      ? {
          items: resultsRef.current ?? [],
          nextCursor: resultPaging.current.cursor,
        }
      : null;
    const readJobs = async () => {
      const head = await jobsApi.jobs({ limit: pageSize, before: null });
      const history = await refreshHistory(
        head,
        previousJobs,
        (before) => jobsApi.jobs({ limit: pageSize, before }),
        isCurrent,
      );
      const items = await recoverMissingJobs(
        previousActive,
        head.active,
        history.items,
        async (id) => summarizeJob(await jobsApi.get(id)),
        isCurrent,
      );
      return { active: head.active, history: { ...history, items } };
    };
    const readResults = async () => {
      const head = await resultsApi.results({ limit: pageSize, before: null });
      return refreshHistory(
        head,
        previousResults,
        (before) => resultsApi.results({ limit: pageSize, before }),
        isCurrent,
      );
    };
    const request = Promise.allSettled([readJobs(), readResults()])
      .then(([nextJobs, nextResults]) => {
        if (
          !active.current ||
          requestedLifetime !== lifetime.current ||
          revision !== mutationRevision.current
        )
          return;
        const errors: string[] = [];
        if (nextJobs.status === "fulfilled") {
          const page = nextJobs.value;
          jobsRef.current = reconcileJobs(page.active, page.history.items, jobsRef.current);
          setJobs(jobsRef.current);
          if (!jobPaging.current.initialized) {
            jobPaging.current.initialized = true;
            jobPaging.current.cursor = page.history.nextCursor;
            setJobCursor(page.history.nextCursor);
          }
        } else errors.push(`任务：${errorMessage(nextJobs.reason)}`);
        if (nextResults.status === "fulfilled") {
          const page = nextResults.value;
          resultsRef.current = mergeSummaries(page.items, resultsRef.current ?? []);
          setResults(resultsRef.current);
          if (!resultPaging.current.initialized) {
            resultPaging.current.initialized = true;
            resultPaging.current.cursor = page.nextCursor;
            setResultCursor(page.nextCursor);
          }
        } else errors.push(`结果：${errorMessage(nextResults.reason)}`);
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
  const acceptJob = useCallback(
    (record: JobRecord) => {
      if (!active.current) return;
      mutationRevision.current++;
      const value = summarizeJob(record);
      jobsRef.current = mergeSummaries([value], jobsRef.current);
      setJobs(jobsRef.current);
      if (pending.current) void pending.current.then(refresh);
      else void refresh();
    },
    [refresh],
  );
  // A long-running task may finish outside the newest historical page.
  const refreshJob = useCallback(
    async (id: string) => {
      mutationRevision.current += 1;
      const requestedLifetime = lifetime.current;
      try {
        const record = await jobsApi.get(id);
        if (active.current && requestedLifetime === lifetime.current) acceptJob(record);
      } catch (cause) {
        if (active.current && requestedLifetime === lifetime.current)
          setQueryError(`任务：${errorMessage(cause)}`);
      }
    },
    [acceptJob],
  );
  const loadMoreJobs = useCallback(async () => {
    const paging = jobPaging.current;
    if (!active.current || paging.pending || paging.cursor === null) return;
    paging.pending = true;
    setMoreJobs(true);
    const requestedLifetime = lifetime.current;
    try {
      const page = await jobsApi.jobs({ limit: pageSize, before: paging.cursor });
      if (!active.current || requestedLifetime !== lifetime.current) return;
      paging.cursor = page.nextCursor;
      setJobCursor(page.nextCursor);
      jobsRef.current = mergeSummaries(jobsRef.current, page.items);
      setJobs(jobsRef.current);
      setQueryError(null);
    } catch (cause) {
      if (active.current) setQueryError(`任务：${errorMessage(cause)}`);
    } finally {
      paging.pending = false;
      if (active.current && requestedLifetime === lifetime.current) setMoreJobs(false);
    }
  }, []);
  const loadMoreResults = useCallback(async () => {
    const paging = resultPaging.current;
    if (!active.current || paging.pending || paging.cursor === null) return;
    paging.pending = true;
    setMoreResults(true);
    const requestedLifetime = lifetime.current;
    try {
      const page = await resultsApi.results({ limit: pageSize, before: paging.cursor });
      if (!active.current || requestedLifetime !== lifetime.current) return;
      paging.cursor = page.nextCursor;
      setResultCursor(page.nextCursor);
      resultsRef.current = mergeSummaries(resultsRef.current ?? [], page.items);
      setResults(resultsRef.current);
      setQueryError(null);
    } catch (cause) {
      if (active.current) setQueryError(`结果：${errorMessage(cause)}`);
    } finally {
      paging.pending = false;
      if (active.current && requestedLifetime === lifetime.current) setMoreResults(false);
    }
  }, []);
  return {
    jobs,
    results,
    queryError,
    refreshing,
    refresh,
    acceptJob,
    refreshJob,
    loadMoreJobs,
    loadMoreResults,
    loadingMoreJobs: moreJobs,
    loadingMoreResults: moreResults,
    hasMoreJobs: jobCursor !== null,
    hasMoreResults: resultCursor !== null,
  };
}
