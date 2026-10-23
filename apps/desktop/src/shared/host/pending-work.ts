import { useSyncExternalStore } from "react";

const pending = new Set<Promise<unknown>>();
const listeners = new Set<() => void>();
const waitingQueues = new Set<Set<Promise<unknown>>>();

function publish() {
  for (const listener of listeners) listener();
}

/** Track the complete operation, including committing its result into editable state. */
export function trackPendingWork<T>(work: Promise<T>): Promise<T> {
  const tracked = work.then(
    (value) => {
      pending.delete(tracked);
      publish();
      return value;
    },
    (cause: unknown) => {
      pending.delete(tracked);
      publish();
      throw cause;
    },
  );
  pending.add(tracked);
  for (const queue of waitingQueues) queue.add(tracked);
  publish();
  return tracked;
}

export function hasPendingWork(): boolean {
  return pending.size > 0;
}

/** Drain work added while waiting, then propagate a failure without abandoning other work. */
export async function waitForPendingWork(): Promise<void> {
  // Keep newly observed tasks even if they finish before the current batch does.
  const queue = new Set(pending);
  waitingQueues.add(queue);
  let failed = false;
  let failure: unknown;
  try {
    while (queue.size > 0) {
      const batch = [...queue];
      queue.clear();
      const outcomes = await Promise.allSettled(batch);
      for (const outcome of outcomes) {
        if (outcome.status === "rejected" && !failed) {
          failed = true;
          failure = outcome.reason;
        }
      }
    }
    if (failed) throw failure;
  } finally {
    waitingQueues.delete(queue);
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const count = () => pending.size;

export function usePendingWork(): number {
  return useSyncExternalStore(subscribe, count, count);
}
