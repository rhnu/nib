import type { VibeEncodingInput, VibeEncodingOptions } from "@/bindings/workbench";
import { invokeHost } from "@/shared/host/invoke";
import type { VibeEncodingOutcome } from "@/bindings/generation";

export const encodingApi = {
  options: () => invokeHost<VibeEncodingOptions>("get_vibe_encoding_options"),
  create: (id: string, model: string) =>
    invokeHost<VibeEncodingInput>("create_vibe_encoding_input", { id, model }),
  ensure: (input: VibeEncodingInput, policy: "normalize" | "reject") =>
    invokeHost<VibeEncodingOutcome>("ensure_vibe_encoding", { input, policy }),
};
