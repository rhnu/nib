import type { GenerationSettings, ModelCapabilities } from "../../bindings/workbench";
import { invokeHost } from "../../shared/host/invoke";

export const modelApi = {
  capabilities: (model?: string, settings?: GenerationSettings | null) =>
    invokeHost<ModelCapabilities>("get_model_defaults_capabilities", {
      model: model ?? null,
      settings: settings ?? null,
    }),
};
