import init, { analyze } from "@/bindings/prompt-wasm/nib_prompt";
import type { AnalysisRequest, AnalysisResponse } from "./analysis-protocol";

let initialized: ReturnType<typeof init> | undefined;

/** The worker executes the same Rust parser used by the desktop host. */
self.onmessage = async (event: MessageEvent<AnalysisRequest>) => {
  const { id, text, profile, context } = event.data;
  let response: AnalysisResponse;
  try {
    initialized ??= init();
    await initialized;
    response = { id, document: analyze(text, profile, context) };
  } catch (cause) {
    initialized = undefined;
    response = { id, error: cause instanceof Error ? cause.message : String(cause) };
  }
  self.postMessage(response);
};
