import type { Draft } from "../../bindings/workbench";
import type {
  AccountStatus,
  GenerationQuote,
  GenerationResult,
  JobRecord,
} from "../../bindings/generation";
import { invokeHost } from "../../shared/host/invoke";

export const generationApi = {
  account: () => invokeHost<AccountStatus>("get_account_status"),
  saveKey: (key: string) => invokeHost<AccountStatus>("save_account_key", { key }),
  deleteKey: () => invokeHost<AccountStatus>("delete_account_key"),
  quote: (draft: Draft) => invokeHost<GenerationQuote>("quote_generation", { draft }),
  submit: (draft: Draft) => invokeHost<JobRecord>("submit_generation", { draft }),
  jobs: () => invokeHost<JobRecord[]>("list_jobs"),
  cancel: (id: string) => invokeHost<JobRecord>("cancel_job", { id }),
  retry: (id: string) => invokeHost<JobRecord>("retry_job", { id }),
  results: () => invokeHost<GenerationResult[]>("list_results"),
  image: (id: string) => invokeHost<ArrayBuffer>("read_result_image", { id }),
  restore: (id: string) => invokeHost<Draft>("restore_result", { id }),
};
