import { describe, expect, it, vi } from "vitest";
import type { JobFeedback } from "../../../bindings/generation";
import { createFeedbackSubscriptions } from "./feedback-subscription";

const event: JobFeedback = { kind: "finalReceived", jobId: "job", sampleIndex: 0 };

describe("window feedback subscription ownership", () => {
  it("orders disconnect before replacement and discards delivery after cleanup", async () => {
    const subscriptions = createFeedbackSubscriptions();
    const calls: string[] = [];
    let deliver: (event: JobFeedback) => void = () => {};
    let resolvePending = () => {};
    const pending = new Promise<void>((resolve) => {
      resolvePending = resolve;
    });
    const onMessage = vi.fn();
    const first = subscriptions.connect({
      subscribe: (receive) => {
        calls.push("first subscribe");
        deliver = receive;
        return pending;
      },
      unsubscribe: async () => {
        calls.push("first unsubscribe");
      },
      onMessage,
      onConnected: vi.fn(),
      onError: vi.fn(),
    });
    await Promise.resolve();
    deliver(event);
    expect(onMessage).toHaveBeenCalledTimes(1);
    const disposed = first.disconnect();
    deliver(event);
    const second = subscriptions.connect({
      subscribe: async () => {
        calls.push("second subscribe");
      },
      unsubscribe: async () => {
        calls.push("second unsubscribe");
      },
      onMessage: vi.fn(),
      onConnected: vi.fn(),
      onError: vi.fn(),
    });
    expect(calls).toEqual(["first subscribe"]);
    resolvePending();
    await first.ready;
    await disposed;
    await second.ready;
    expect(calls).toEqual(["first subscribe", "first unsubscribe", "second subscribe"]);
    expect(onMessage).toHaveBeenCalledTimes(1);
    await second.disconnect();
  });

  it("does not connect an already disposed effect and permits reconnect after failure", async () => {
    const subscriptions = createFeedbackSubscriptions();
    const subscribe = vi.fn(async () => {});
    const skipped = subscriptions.connect({
      subscribe,
      unsubscribe: async () => {},
      onMessage: vi.fn(),
      onConnected: vi.fn(),
      onError: vi.fn(),
    });
    await skipped.disconnect();
    expect(subscribe).not.toHaveBeenCalled();
    const error = new Error("connection unavailable");
    const onError = vi.fn();
    const failed = subscriptions.connect({
      subscribe: async () => {
        throw error;
      },
      unsubscribe: async () => {
        throw error;
      },
      onMessage: vi.fn(),
      onConnected: vi.fn(),
      onError,
    });
    await failed.ready;
    expect(onError).toHaveBeenCalledWith(error);
    await failed.disconnect().catch(() => {});
    const onConnected = vi.fn();
    const next = subscriptions.connect({
      subscribe,
      unsubscribe: async () => {},
      onMessage: vi.fn(),
      onConnected,
      onError,
    });
    await next.ready;
    expect(onConnected).toHaveBeenCalledOnce();
    await next.disconnect();
  });
});
