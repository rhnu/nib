import { Channel } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { JobFeedback, JobRecord } from "../../bindings/generation";
import { errorMessage } from "../../shared/host/error";
import { generationApi } from "./api";
import { emptyFeedback, receiveFeedback, reconcileFeedback } from "./feedback-state";
import { createFeedbackSubscriptions } from "./feedback-subscription";

// Serialize window subscription commands across effect cleanup/remount and reconnects.
const subscriptions = createFeedbackSubscriptions();

export function useJobFeedback(jobs: JobRecord[] | null, refresh: () => Promise<void>) {
  const [feedback, setFeedback] = useState(emptyFeedback);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const jobsRef = useRef(jobs);
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);
  const reconciled = jobs ? reconcileFeedback(feedback, jobs) : feedback;
  if (reconciled !== feedback) setFeedback(reconciled);
  useEffect(() => {
    let stopped = false;
    const subscriptionId = crypto.randomUUID();
    const channel = new Channel<JobFeedback>();
    const onMessage = (event: JobFeedback) => {
      if (stopped) return;
      setFeedback((state) => receiveFeedback(state, event, jobsRef.current ?? []));
      if (event.kind === "resyncRequired") {
        void refresh().then(() => {
          if (!stopped) void refresh();
        });
        return;
      }
      if (event.kind === "finished" || event.kind === "started") {
        // A request already in flight may have read the preceding durable state.
        void refresh().then(() => {
          if (!stopped) void refresh();
        });
      }
    };
    const connection = subscriptions.connect({
      subscribe: (receive) => {
        channel.onmessage = receive;
        return generationApi.subscribeFeedback(subscriptionId, channel);
      },
      unsubscribe: () => generationApi.unsubscribeFeedback(subscriptionId),
      onMessage,
      onConnected: () => setFeedbackError(null),
      onError: (cause) => setFeedbackError(errorMessage(cause)),
    });
    return () => {
      stopped = true;
      channel.onmessage = () => {};
      void connection.disconnect().catch(() => {});
    };
  }, [attempt, refresh]);
  const reconnectFeedback = useCallback(() => {
    setFeedbackError(null);
    setAttempt((value) => value + 1);
  }, []);
  return {
    feedback: feedback.samples,
    jobObservations: feedback.observations,
    feedbackError,
    reconnectFeedback,
  };
}
