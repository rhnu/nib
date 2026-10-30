import type { ResultPage, ResultQuery, GenerationResult } from "@/bindings/generation";
import type { Draft } from "@/bindings/workbench";
import { invokeHost } from "@/shared/host/invoke";
export const resultsApi = {
  results: (query: ResultQuery) => invokeHost<ResultPage>("list_results", { query }),
  get: (id: string) => invokeHost<GenerationResult>("get_result", { id }),
  restore: (id: string) => invokeHost<Draft>("restore_result", { id }),
};
