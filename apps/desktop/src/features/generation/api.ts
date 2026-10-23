import type { Draft } from "../../bindings/workbench";
import type {
  AccountStatus,
  AccountSummary,
  GenerationQuote,
  GenerationResult,
  JobRecord,
  JobFeedback,
} from "../../bindings/generation";
import type { Channel } from "@tauri-apps/api/core";
import { invokeHost } from "../../shared/host/invoke";

export const generationApi = {
  account: () => invokeHost<AccountStatus>("get_account_status"),
  saveKey: (key: string) => invokeHost<AccountStatus>("save_account_key", { key }),
  deleteKey: () => invokeHost<AccountStatus>("delete_account_key"),
  accountSummary: () => invokeHost<AccountSummary | null>("get_account_summary"),
  refreshAccountSummary: () => invokeHost<AccountSummary>("refresh_account_summary"),
  subscribeFeedback: (subscriptionId: string, onEvent: Channel<JobFeedback>) =>
    invokeHost<void>("subscribe_job_feedback", { subscriptionId, onEvent }),
  unsubscribeFeedback: (subscriptionId: string) =>
    invokeHost<void>("unsubscribe_job_feedback", { subscriptionId }),
  quote: (draft: Draft) => invokeHost<GenerationQuote>("quote_generation", { draft }),
  submit: (draft: Draft) => invokeHost<JobRecord>("submit_generation", { draft }),
  jobs: () => invokeHost<JobRecord[]>("list_jobs"),
  cancel: (id: string) => invokeHost<JobRecord>("cancel_job", { id }),
  retry: (id: string) => invokeHost<JobRecord>("retry_job", { id }),
  results: () => invokeHost<GenerationResult[]>("list_results"),
  image: (id: string) => invokeHost<ArrayBuffer>("read_result_content", { id }),
  restore: (id: string) => invokeHost<Draft>("restore_result", { id }),
};
