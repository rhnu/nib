import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptDocument, PromptSyntaxProfile } from "@/bindings/prompt";
import type { AnalysisRequest, AnalysisResponse } from "./analysis-protocol";
import { registerPromptAnalysis } from "./analysis-runtime";

const profile: PromptSyntaxProfile = {
  bracketWeights: false,
  numericWeights: false,
  negativeWeights: false,
  legacyMixing: false,
  characterSeparators: false,
  randomizer: false,
  textRendering: false,
  interactionTags: false,
};

class ControlledWorker {
  static instances: ControlledWorker[] = [];

  requests: AnalysisRequest[] = [];

  onmessage?: (event: MessageEvent<AnalysisResponse>) => void;

  onerror?: (event: ErrorEvent) => void;

  terminated = false;

  constructor() {
    ControlledWorker.instances.push(this);
  }

  postMessage(request: AnalysisRequest) {
    this.requests.push(request);
  }

  terminate() {
    this.terminated = true;
  }

  complete() {
    const request = this.requests.at(-1)!;
    const document: PromptDocument = {
      text: request.text,
      comments: [],
      sourceMap: [],
      sourceDiagnostics: [],
      analysis: { tokens: [], spans: [], diagnostics: [] },
      valid: true,
    };
    this.onmessage?.({ data: { id: request.id, document } } as MessageEvent<AnalysisResponse>);
  }
}

const clients: ReturnType<typeof registerPromptAnalysis>[] = [];

function client() {
  const result = registerPromptAnalysis();
  clients.push(result);
  return result;
}

beforeEach(() => {
  ControlledWorker.instances = [];
  vi.stubGlobal("Worker", ControlledWorker);
});

afterEach(() => {
  for (const item of clients.splice(0)) item.dispose();
  vi.unstubAllGlobals();
});

describe("shared prompt analysis scheduling", () => {
  it("starts lazily and coalesces queued edits independently for each editor", () => {
    const first = client();
    const second = client();
    expect(ControlledWorker.instances).toHaveLength(0);
    const changed = vi.fn();
    first.analyze({ text: "first", profile, context: "editable" }, changed);
    const worker = ControlledWorker.instances[0];
    second.analyze({ text: "outdated", profile, context: "editable" }, changed);
    second.analyze({ text: "latest", profile, context: "editable" }, changed);
    expect(worker.requests.map((item) => item.text)).toEqual(["first"]);
    worker.complete();
    expect(worker.requests.map((item) => item.text)).toEqual(["first", "latest"]);
    worker.complete();
    expect(changed.mock.calls.map(([result]) => result.text)).toEqual(["first", "latest"]);
  });

  it("ignores a canceled running revision while allowing another editor to complete", () => {
    const first = client();
    const second = client();
    const obsolete = vi.fn();
    const current = vi.fn();
    const cancel = first.analyze({ text: "old", profile, context: "editable" }, obsolete);
    second.analyze({ text: "current", profile, context: "native" }, current);
    cancel();
    const worker = ControlledWorker.instances[0];
    worker.complete();
    worker.complete();
    expect(obsolete).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledOnce();
    expect(current.mock.calls[0][0].text).toBe("current");
  });

  it("rejects an older in-flight result when a newer revision was requested", () => {
    const editor = client();
    const obsolete = vi.fn();
    const current = vi.fn();
    editor.analyze({ text: "old", profile, context: "editable" }, obsolete);
    editor.analyze({ text: "new", profile, context: "editable" }, current);
    const worker = ControlledWorker.instances[0];
    worker.complete();
    expect(obsolete).not.toHaveBeenCalled();
    worker.complete();
    expect(current.mock.calls[0][0].text).toBe("new");
  });

  it("reports worker failure to all waiting editors and initializes a new worker on retry", () => {
    const first = client();
    const second = client();
    const failures = vi.fn();
    first.analyze({ text: "one", profile, context: "editable" }, failures);
    second.analyze({ text: "two", profile, context: "editable" }, failures);
    const failed = ControlledWorker.instances[0];
    failed.onerror?.({ message: "WASM unavailable", preventDefault() {} } as ErrorEvent);
    expect(failures).toHaveBeenCalledTimes(2);
    expect(failures.mock.calls.every(([result]) => result instanceof Error)).toBe(true);
    expect(failed.terminated).toBe(true);
    const retried = vi.fn();
    first.analyze({ text: "retry", profile, context: "editable" }, retried);
    expect(ControlledWorker.instances).toHaveLength(2);
    failed.onerror?.({ message: "late failure", preventDefault() {} } as ErrorEvent);
    expect(ControlledWorker.instances[1].terminated).toBe(false);
    ControlledWorker.instances[1].complete();
    expect(retried.mock.calls[0][0].text).toBe("retry");
  });

  it("unregisters disposed editors and releases the worker when all editors close", () => {
    const first = client();
    const second = client();
    const closed = vi.fn();
    first.analyze({ text: "running", profile, context: "editable" }, closed);
    second.analyze({ text: "queued", profile, context: "editable" }, closed);
    first.dispose();
    second.dispose();
    const worker = ControlledWorker.instances[0];
    worker.complete();
    expect(closed).not.toHaveBeenCalled();
    expect(worker.terminated).toBe(true);
  });
});
