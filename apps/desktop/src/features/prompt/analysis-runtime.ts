import type { PromptDocument } from "@/bindings/prompt";
import type { AnalysisRequest, AnalysisResponse } from "./analysis-protocol";

type Pending = {
  request: AnalysisRequest;
  complete: (result: PromptDocument | Error) => void;
};

let worker: Worker | undefined;
let nextId = 0;
let active: { editor: symbol; pending: Pending } | undefined;
const clients = new Set<symbol>();
const queue = new Map<symbol, Pending>();

function fail(cause: string) {
  worker?.terminate();
  worker = undefined;
  const pending = [...queue.values()];
  queue.clear();
  if (active) pending.unshift(active.pending);
  active = undefined;
  for (const item of pending) item.complete(new Error(cause));
}

/** A single active request bounds work; each editor retains only its newest queued revision. */
function pump() {
  if (active || !queue.size) return;
  const [editor, pending] = queue.entries().next().value!;
  queue.delete(editor);
  active = { editor, pending };
  try {
    if (!worker) {
      const created = new Worker(new URL("./analysis-worker.ts", import.meta.url), {
        type: "module",
      });
      worker = created;
      created.onmessage = (event: MessageEvent<AnalysisResponse>) => {
        const result = event.data;
        if (!active || result.id !== active.pending.request.id) return;
        const current = active;
        active = undefined;
        if (clients.has(current.editor)) {
          current.pending.complete("error" in result ? new Error(result.error) : result.document);
        }
        pump();
      };
      created.onerror = (event) => {
        event.preventDefault();
        if (worker === created)
          fail(event.message || "The prompt analysis worker could not start.");
      };
      created.onmessageerror = () => {
        if (worker === created) fail("The prompt analysis response could not be read.");
      };
    }
    worker.postMessage(pending.request);
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : String(cause));
  }
}

export function registerPromptAnalysis() {
  const editor = Symbol("prompt-editor");
  let latestRequest = 0;
  clients.add(editor);
  return {
    analyze(input: Omit<AnalysisRequest, "id">, complete: Pending["complete"]): () => void {
      const request = { ...input, id: ++nextId };
      latestRequest = request.id;
      queue.set(editor, {
        request,
        complete: (result) => {
          if (latestRequest === request.id) complete(result);
        },
      });
      pump();
      return () => {
        if (queue.get(editor)?.request.id === request.id) queue.delete(editor);
        if (latestRequest === request.id) latestRequest = 0;
        // Running WASM is synchronous. Its response may arrive, but cannot update a stale revision.
        if (active?.pending.request.id === request.id) active.pending.complete = () => {};
      };
    },
    dispose() {
      clients.delete(editor);
      queue.delete(editor);
      if (active?.editor === editor) active.pending.complete = () => {};
      if (!clients.size) {
        worker?.terminate();
        worker = undefined;
        active = undefined;
      }
    },
  };
}
