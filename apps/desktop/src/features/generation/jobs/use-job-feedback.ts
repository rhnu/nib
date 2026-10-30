import { jobsApi } from "./api";
import { Channel } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { JobFeedback, JobSummary } from "@/bindings/generation";
import { errorMessage } from "@/shared/host/error";
import {
  emptyFeedback,
  receiveFeedback,
  reconcileFeedback,
  releaseFeedbackFrame,
} from "./feedback-state";
import { createFeedbackSubscriptions } from "./feedback-subscription";

// Serialize window subscription commands across effect cleanup/remount and reconnects.
const subscriptions = createFeedbackSubscriptions();

export function useJobFeedback(
  jobs: JobSummary[] | null,
  refresh: () => Promise<void>,
  refreshJob: (id: string) => Promise<void>,
) {
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
      if (event.kind === "finished") {
        void refreshJob(event.jobId);
        return;
      }
      if (event.kind === "started") {
        // A request already in flight may have read the preceding durable state.
        void refresh().then(() => {
          if (!stopped) void refresh();
        });
      }
    };

    const connection = subscriptions.connect({
      subscribe: (receive) => {
        channel.onmessage = receive;
        return jobsApi.subscribeFeedback(subscriptionId, channel);
      },
      unsubscribe: () => jobsApi.unsubscribeFeedback(subscriptionId),
      onMessage,
      onConnected: () => setFeedbackError(null),
      onError: (cause) => setFeedbackError(errorMessage(cause)),
    });
    return () => {
      stopped = true;
      channel.onmessage = () => {};
      void connection.disconnect().catch(() => {});
    };
  }, [attempt, refresh, refreshJob]);

  const reconnectFeedback = useCallback(() => {
    setFeedbackError(null);
    setAttempt((value) => value + 1);
  }, []);

  const releasePreview = useCallback((jobId: string, sampleIndex: number) => {
    setFeedback((state) => releaseFeedbackFrame(state, jobId, sampleIndex));
  }, []);

  return {
    feedback: feedback.samples,
    jobObservations: feedback.observations,
    feedbackError,
    reconnectFeedback,
    releasePreview,
  };
}
