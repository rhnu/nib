import type { JobFeedback } from "../../../bindings/generation";

type Connection = {
  subscribe: (receive: (event: JobFeedback) => void) => Promise<void>;
  unsubscribe: () => Promise<void>;
  onMessage: (event: JobFeedback) => void;
  onConnected: () => void;
  onError: (cause: unknown) => void;
};

/** Own the window command order, including cleanup during an unresolved subscription. */
export function createFeedbackSubscriptions() {
  let lifecycle = Promise.resolve();
  const schedule = (action: () => Promise<void>) => {
    const next = lifecycle.then(action);
    lifecycle = next.catch(() => {});
    return next;
  };
  return {
    connect(connection: Connection) {
      let active = true;
      const ready = schedule(async () => {
        if (!active) return;
        try {
          await connection.subscribe((event) => {
            if (active) connection.onMessage(event);
          });
          if (active) connection.onConnected();
        } catch (cause) {
          if (active) connection.onError(cause);
        }
      });
      return {
        ready,
        disconnect() {
          if (!active) return lifecycle;
          active = false;
          return schedule(connection.unsubscribe);
        },
      };
    },
  };
}
