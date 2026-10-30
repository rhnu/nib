import { useCallback, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import type { Draft } from "@/bindings/workbench";
import { submissionApi } from "./api";
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
  const latest = useRef(beforeSubmit);
  useLayoutEffect(() => {
    latest.current = beforeSubmit;
  }, [beforeSubmit]);

  const submit = useCallback(async (draft: Draft) => {
    await latest.current?.();
    return submissionApi.submit(draft);
  }, []);

  const value = useMemo(() => ({ submit, submissionBlocked }), [submit, submissionBlocked]);
  return <SubmissionContext value={value}>{children}</SubmissionContext>;
}
