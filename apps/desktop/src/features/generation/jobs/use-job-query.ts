import { useCallback, useMemo, useState } from "react";
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import type { GenerationBatch, JobRecord, JobPage, ResultPage } from "@/bindings/generation";
import { errorMessage } from "@/shared/host/error";
import { jobsApi } from "./api";
import { resultsApi } from "../results/api";
import { mergeSummaries, summarizeJob } from "./summary";
import { refreshHistory } from "./paged-history";
import { recoverMissingJobs } from "./recover-missing-jobs";

export const jobQueryKey = ["jobs"] as const;
export const resultQueryKey = ["results"] as const;
const recentResultsKey = [...resultQueryKey, "images"] as const;
const pageSize = 50;

/** Durable state is queried once; stream notifications invalidate the matching queries. */
export function useJobQuery() {
  const client = useQueryClient();
  const [lastSubmission, setLastSubmission] = useState<GenerationBatch | null>(null);
  const jobsQuery = useInfiniteQuery({
    queryKey: jobQueryKey,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const page = await jobsApi.jobs({ limit: pageSize, before: pageParam });
      if (pageParam === null) {
        const previous = client.getQueryData<InfiniteData<JobPage>>(jobQueryKey)?.pages[0];
        const history = await refreshHistory(
          page,
          previous?.items.length ? previous : null,
          (before) => jobsApi.jobs({ limit: pageSize, before }),
          () => !signal.aborted,
        );
        page.items = await recoverMissingJobs(
          previous?.active ?? [],
          page.active,
          history.items,
          async (id) => summarizeJob(await jobsApi.get(id)),
          () => !signal.aborted,
        );
        page.nextCursor = history.nextCursor;
      }
      return page;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: (query) => (query.state.data?.pages[0]?.active.length ? 2_000 : 30_000),
  });
  const resultsQuery = useInfiniteQuery({
    queryKey: recentResultsKey,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const page = await resultsApi.results({
        limit: 200,
        before: pageParam,
        kind: "image",
        jobId: null,
      });
      if (pageParam !== null) return page;
      const previous = client.getQueryData<InfiniteData<ResultPage>>(recentResultsKey)?.pages[0];
      return refreshHistory(
        page,
        previous?.items.length ? previous : null,
        (before) => resultsApi.results({ limit: 200, before, kind: "image", jobId: null }),
        () => !signal.aborted,
      );
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: 30_000,
  });
  const jobs = useMemo(() => {
    if (!jobsQuery.data) return null;
    const [head] = jobsQuery.data.pages;
    const history = jobsQuery.data.pages.reduce(
      (all, page) => mergeSummaries(all, page.items),
      [] as JobPage["items"],
    );
    return mergeSummaries(head!.active, history);
  }, [jobsQuery.data]);
  const results = useMemo(
    () =>
      resultsQuery.data?.pages.reduce(
        (all, page) => mergeSummaries(all, page.items),
        [] as ResultPage["items"],
      ) ?? null,
    [resultsQuery.data],
  );

  const refresh = useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: jobQueryKey }),
      client.invalidateQueries({ queryKey: resultQueryKey }),
    ]);
  }, [client]);

  const acceptJob = useCallback(
    (record: JobRecord) => {
      const summary = summarizeJob(record);
      // Cancel the old read before optimistic durable state is installed; its late IPC reply is discarded.
      void client.cancelQueries({ queryKey: jobQueryKey });
      void client.cancelQueries({ queryKey: ["job", record.id], exact: true });
      client.setQueryData<InfiniteData<JobPage>>(jobQueryKey, (previous) => {
        const active = summary.status === "queued" || summary.status === "running";
        const pages = previous?.pages ?? [{ active: [], items: [], nextCursor: null }];
        return {
          pageParams: previous?.pageParams ?? [null],
          pages: pages.map((page, index) => ({
            ...page,
            active:
              index === 0 && active
                ? mergeSummaries([summary], page.active)
                : page.active.filter((job) => job.id !== record.id),
            items:
              index === 0 && !active
                ? mergeSummaries([summary], page.items)
                : page.items.filter((job) => job.id !== record.id),
          })),
        };
      });
      client.setQueryData(["job", record.id], record);
      void client.invalidateQueries({ queryKey: resultQueryKey });
      if (summary.status === "completed") void client.invalidateQueries({ queryKey: ["media"] });
    },
    [client],
  );

  const acceptBatch = useCallback(
    (batch: GenerationBatch, select = false) => {
      batch.jobs.forEach(acceptJob);
      if (select) setLastSubmission(batch);
    },
    [acceptJob],
  );

  const refreshJob = useCallback(
    async (id: string) => {
      try {
        acceptJob(await jobsApi.get(id));
      } catch {
        await client.invalidateQueries({ queryKey: ["job", id] });
      } finally {
        await client.invalidateQueries({ queryKey: jobQueryKey });
        await client.invalidateQueries({ queryKey: ["account"] });
      }
    },
    [client, acceptJob],
  );

  return {
    jobs,
    results,
    lastSubmission,
    acceptJob,
    acceptBatch,
    refresh,
    refreshJob,
    queryError:
      [jobsQuery.error, resultsQuery.error].filter(Boolean).map(errorMessage).join("；") || null,
    refreshing: jobsQuery.isFetching || resultsQuery.isFetching,
    hasMoreJobs: jobsQuery.hasNextPage,
    hasMoreResults: resultsQuery.hasNextPage,
    loadingMoreJobs: jobsQuery.isFetchingNextPage,
    loadingMoreResults: resultsQuery.isFetchingNextPage,
    loadMoreJobs: async () => {
      await jobsQuery.fetchNextPage();
    },
    loadMoreResults: async () => {
      await resultsQuery.fetchNextPage();
    },
  };
}
