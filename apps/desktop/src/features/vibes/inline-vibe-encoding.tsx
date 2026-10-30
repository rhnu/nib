import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Binary, LoaderCircle } from "lucide-react";
import type {
  ModelCapabilities,
  VibeEncodingInput,
  VibeReferenceInput,
} from "@/bindings/workbench";
import { errorMessage } from "@/shared/host/error";
import { hasPendingWork, trackPendingWork } from "@/shared/host/pending-work";
import { useDebouncedValue } from "@/shared/query/use-debounced-value";
import { Button, IconButton, Notice } from "@/shared/ui";
import { useAccount } from "@/features/generation/account/account-context";
import { useJobData } from "@/features/generation/jobs/job-context";
import { jobsApi } from "@/features/generation/jobs/api";
import { resultsApi } from "@/features/generation/results/api";
import { submissionApi } from "@/features/generation/submission/api";
import { useSubmission } from "@/features/generation/submission/submission-context";
import { encodingApi } from "./encoding-api";
import { slotEncodingDraft } from "./encoding-model";
import type { VibePatch } from "./model";

type EncodingSnapshot = { key: string; input: VibeEncodingInput };
const activeStatuses = new Set(["queued", "running"]);

/** A paid encode belongs to the originating slot; completed assets remain reusable if the slot changes. */
export function InlineVibeEncoding({
  value,
  capabilities,
  onChange,
  children,
}: {
  value: VibeReferenceInput;
  capabilities: ModelCapabilities | null;
  onChange: (patch: VibePatch) => void;
  children: (action: ReactNode, feedback: ReactNode) => ReactNode;
}) {
  const { accountVersion, accountSummaryLoading } = useAccount();
  const { submissionBlocked } = useSubmission();
  const { acceptJob } = useJobData();
  const source = value.input;
  const model = capabilities?.model;
  const key = JSON.stringify([value.id, source, model]);
  const settledKey = useDebouncedValue(key, 180);
  const ready = key === settledKey;
  const latest = useRef({ active: true, key, onChange });
  const applied = useRef<string | null>(null);
  useLayoutEffect(() => {
    Object.assign(latest.current, { key, onChange });
  }, [key, onChange]);
  useEffect(() => {
    const current = latest.current;
    current.active = true;
    return () => {
      current.active = false;
    };
  }, []);
  const inputQuery = useQuery({
    queryKey: ["vibe-slot-input", source.assetId, model],
    queryFn: () => encodingApi.create(source.assetId, model!),
    enabled: source.kind === "image" && Boolean(model) && capabilities?.encodeVibe === true,
    staleTime: Infinity,
  });
  const input: VibeEncodingInput | null =
    source.kind === "image" && inputQuery.data
      ? { ...inputQuery.data, informationExtracted: source.informationExtracted }
      : null;
  const quote = useQuery({
    queryKey: ["quote", "vibe-slot", input, accountVersion],
    queryFn: () => submissionApi.quote(slotEncodingDraft(input!)),
    enabled: ready && input !== null && !accountSummaryLoading,
    staleTime: Infinity,
    gcTime: 30_000,
  });
  const commit = (assetId: string, snapshot: EncodingSnapshot) => {
    const current = latest.current;
    if (!current.active || current.key !== snapshot.key) return;
    current.onChange({ input: { kind: "encoded", assetId } });
  };
  const encode = useMutation({
    mutationFn: (snapshot: EncodingSnapshot) =>
      trackPendingWork(
        (async () => {
          const outcome = await encodingApi.ensure(snapshot.input, "normalize");
          if (outcome.kind === "reused") commit(outcome.assetId, snapshot);
          return outcome;
        })(),
      ),
    onSuccess: (outcome) => {
      if (outcome.kind === "queued") acceptJob(outcome.job);
    },
  });
  const currentRequest = encode.variables?.key === key;
  const queued = currentRequest && encode.data?.kind === "queued" ? encode.data.job : null;
  const job = useQuery({
    queryKey: ["job", queued?.id ?? null],
    queryFn: () => jobsApi.get(queued!.id),
    initialData: queued ?? undefined,
    enabled: Boolean(queued),
    staleTime: 0,
    refetchInterval: (query) => (activeStatuses.has(query.state.data?.status ?? "") ? 1000 : false),
  });
  const result = useQuery({
    queryKey: ["vibe-slot-result", queued?.id ?? null],
    queryFn: () => resultsApi.results({ kind: "vibe", jobId: queued!.id, limit: 1, before: null }),
    enabled: Boolean(queued) && job.data?.status === "completed",
    staleTime: Infinity,
  });
  const encodedAsset = result.data?.items.find((item) => item.available && item.kind === "vibe");
  useEffect(() => {
    if (!encodedAsset || !encode.variables || !queued || applied.current === queued.id) return;
    const snapshot = encode.variables;
    if (latest.current.key !== snapshot.key || !latest.current.active) return;
    applied.current = queued.id;
    void trackPendingWork(
      Promise.resolve().then(() => {
        const current = latest.current;
        if (current.active && current.key === snapshot.key)
          current.onChange({ input: { kind: "encoded", assetId: encodedAsset.assetId } });
      }),
    );
  }, [encodedAsset, encode.variables, queued]);
  const working =
    encode.isPending || Boolean(queued && activeStatuses.has(job.data?.status ?? queued.status));
  const cost = ready && !accountSummaryLoading ? quote.data?.estimatedAnlas : undefined;
  const costLabel = cost == null ? "费用未知" : `${cost} Anlas`;
  const failure =
    currentRequest && encode.error
      ? errorMessage(encode.error)
      : job.error
        ? errorMessage(job.error)
        : result.error
          ? errorMessage(result.error)
          : queued &&
              job.data &&
              !activeStatuses.has(job.data.status) &&
              job.data.status !== "completed"
            ? (job.data.error ?? "编码未完成，请重新编码。")
            : inputQuery.error
              ? errorMessage(inputQuery.error)
              : ready && quote.error
                ? errorMessage(quote.error)
                : null;
  const completedWithoutAsset =
    queued && job.data?.status === "completed" && result.isSuccess && !encodedAsset;
  return children(
    <IconButton
      label={working ? "正在编码" : `编码 · 预计 ${costLabel}；已有匹配编码时直接复用`}
      disabled={
        working ||
        !ready ||
        !input ||
        !quote.data ||
        quote.isError ||
        quote.isPending ||
        quote.isFetching ||
        accountSummaryLoading ||
        submissionBlocked ||
        capabilities?.encodeVibe !== true ||
        Boolean(quote.data?.tooExpensive)
      }
      onClick={() => {
        if (input && latest.current.key === key && !hasPendingWork()) encode.mutate({ key, input });
      }}
    >
      {working ? <LoaderCircle size={14} className="spin" /> : <Binary size={14} />}
    </IconButton>,
    <>
      <output className="vibe-status" aria-live="polite">
        {working
          ? job.data?.status === "running"
            ? "编码中…"
            : "排队中…"
          : `编码 · 预计 ${costLabel}`}
      </output>
      {failure && (
        <Notice
          actions={
            inputQuery.error || quote.error || job.error || result.error ? (
              <Button
                onClick={() => {
                  if (inputQuery.error) void inputQuery.refetch();
                  else if (quote.error) void quote.refetch();
                  else if (job.error) void job.refetch();
                  else if (result.error) void result.refetch();
                }}
              >
                重试读取
              </Button>
            ) : undefined
          }
        >
          {failure}
        </Notice>
      )}
      {completedWithoutAsset && (
        <Notice actions={<Button onClick={() => void result.refetch()}>重试读取</Button>}>
          未读取到可用编码，原图片已保留。
        </Notice>
      )}
    </>,
  );
}
