import type { Channel } from "@tauri-apps/api/core";
import type { JobFeedback, JobPage, JobQuery, JobRecord } from "@/bindings/generation";
import { invokeHost } from "@/shared/host/invoke";

export const jobsApi = {
  jobs: (query: JobQuery) => invokeHost<JobPage>("list_jobs", { query }),
  get: (id: string) => invokeHost<JobRecord>("get_job", { id }),
  cancel: (id: string) => invokeHost<JobRecord>("cancel_job", { id }),
  retry: (id: string) => invokeHost<JobRecord>("retry_job", { id }),
  subscribeFeedback: (subscriptionId: string, onEvent: Channel<JobFeedback>) =>
    invokeHost<void>("subscribe_job_feedback", { subscriptionId, onEvent }),
  unsubscribeFeedback: (subscriptionId: string) =>
    invokeHost<void>("unsubscribe_job_feedback", { subscriptionId }),
};
