import { useEffect } from "react";
import { t } from "@/shared/i18n";
import { notify } from "@/shared/ui";
import { useJobData } from "./job-context";

/** Native notifications own background delivery; foreground feedback uses the shared viewport. */
export function JobNotifications() {
  const { jobs, batchNotifications: observer } = useJobData();
  useEffect(() => {
    for (const notice of observer.update(jobs ?? [])) {
      if (document.hasFocus())
        notify(
          () =>
            t(notice.failed ? "generation.batchFailed" : "generation.batchCompleted", {
              count: notice.count,
            }),
          `batch-${notice.id}`,
          notice.failed,
        );
    }
  }, [jobs, observer]);
  return null;
}
