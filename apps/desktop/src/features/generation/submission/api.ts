import type { Draft } from "../../../bindings/workbench";
import type { GenerationQuote, JobRecord } from "../../../bindings/generation";
import { invokeHost } from "../../../shared/host/invoke";

export const submissionApi = {
  quote: (draft: Draft) => invokeHost<GenerationQuote>("quote_generation", { draft }),
  submit: (draft: Draft) => invokeHost<JobRecord>("submit_generation", { draft }),
};
