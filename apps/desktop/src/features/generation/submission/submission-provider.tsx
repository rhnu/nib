import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { t, MessageError, deferMessage } from "@/shared/i18n";
import type { Draft } from "@/bindings/workbench";
import { submissionApi } from "./api";
import { useJobData } from "../jobs/job-context";
import { originForOperation, workStatus, type SubmissionOrigin } from "./work-state";
import { SubmissionContext } from "./submission-context";

export function SubmissionProvider({
  beforeSubmit,
  submissionBlocked,
  children,
}: {
  beforeSubmit?: () => Promise<void>;
  submissionBlocked: boolean;
  children: ReactNode;
}) {
  const { jobs, acceptBatch } = useJobData();
  const [pending, setPending] = useState<Partial<Record<SubmissionOrigin, boolean>>>({});
  const gates = useRef(new Set<SubmissionOrigin>());
  const jobsRef = useRef(jobs);
  const latest = useRef(beforeSubmit);
  useLayoutEffect(() => {
    latest.current = beforeSubmit;
    jobsRef.current = jobs;
  }, [beforeSubmit, jobs]);

  const submit = useCallback(
    async (draft: Draft) => {
      const origin = originForOperation(draft.inputs.operation.kind);
      if (gates.current.has(origin) || workStatus(jobsRef.current, origin, false) !== "idle")
        throw new MessageError(deferMessage(() => t("generation.working")));
      gates.current.add(origin);
      setPending((value) => ({ ...value, [origin]: true }));
      try {
        await latest.current?.();
        const batch = await submissionApi.submit(draft);
        acceptBatch(batch, true);
        return batch;
      } finally {
        gates.current.delete(origin);
        setPending((value) => ({ ...value, [origin]: false }));
      }
    },
    [acceptBatch],
  );

  const value = useMemo(
    () => ({
      submit,
      submissionBlocked,
      work: {
        create: workStatus(jobs, "create", Boolean(pending.create)),
        director: workStatus(jobs, "director", Boolean(pending.director)),
      },
    }),
    [submit, submissionBlocked, jobs, pending],
  );
  return <SubmissionContext value={value}>{children}</SubmissionContext>;
}
