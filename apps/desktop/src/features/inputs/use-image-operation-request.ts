import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CreationOperation, Draft } from "@/bindings/workbench";
import type { MediaAsset } from "@/bindings/media";
import { errorMessage } from "@/shared/host/error";
import { trackPendingWork } from "@/shared/host/pending-work";
import { mediaApi } from "@/features/media/api";
import {
  applyImageOperation,
  imageOperationApi,
  imageOperationNeedsConfirmation,
  type ImageOperationAction,
} from "./image-operation";

type Candidate = { asset: MediaAsset | null; operation: CreationOperation };

/** Sidebar and result actions share preparation, replacement confirmation and live draft edits. */
export function useImageOperationRequest({
  readCurrentDraft,
  edit,
  onError,
  contextVersion,
}: {
  readCurrentDraft: () => Draft;
  edit: (draft: Draft) => void;
  onError: (message: string) => void;
  contextVersion: number;
}) {
  const [candidateState, setCandidateState] = useState<{
    contextVersion: number;
    value: Candidate | null;
  } | null>(null);
  const [busyState, setBusyState] = useState<{ contextVersion: number; value: boolean } | null>(
    null,
  );
  const candidate = candidateState?.contextVersion === contextVersion ? candidateState.value : null;
  const busy = busyState?.contextVersion === contextVersion && busyState.value;

  const setCandidate = (value: Candidate | null) => setCandidateState({ contextVersion, value });

  const setBusy = (value: boolean) => setBusyState({ contextVersion, value });

  const lifetime = useRef({ active: true, sequence: 0 });
  useLayoutEffect(() => {
    lifetime.current.sequence += 1;
  }, [contextVersion]);
  useEffect(() => {
    const current = lifetime.current;
    current.active = true;
    return () => {
      current.active = false;
      current.sequence += 1;
    };
  }, []);

  const nextDraft = (current: Draft, value: Candidate) =>
    value.asset
      ? applyImageOperation(current, value.asset, value.operation)
      : { ...current, inputs: { ...current.inputs, operation: value.operation } };

  const offer = (value: Candidate) => {
    const current = readCurrentDraft();
    const next = nextDraft(current, value);
    if (imageOperationNeedsConfirmation(current, next)) setCandidate(value);
    else edit(next);
  };

  async function request(id: string, kind: ImageOperationAction) {
    if (kind === "inpainting") return;
    const sequence = ++lifetime.current.sequence;
    setBusy(true);
    setCandidate(null);
    try {
      await trackPendingWork(
        (async () => {
          const [asset, operation] = await Promise.all([
            mediaApi.asset(id),
            imageOperationApi.create(id, kind),
          ]);
          if (!lifetime.current.active || sequence !== lifetime.current.sequence) return;
          offer({ asset, operation });
        })(),
      );
    } catch (cause) {
      if (lifetime.current.active && sequence === lifetime.current.sequence)
        onError(errorMessage(cause));
      throw cause;
    } finally {
      if (lifetime.current.active && sequence === lifetime.current.sequence) setBusy(false);
    }
  }

  return {
    busy,
    candidate,
    request,
    returnToText: () => {
      lifetime.current.sequence += 1;
      setBusy(false);
      offer({ asset: null, operation: { kind: "textToImage" } });
    },
    cancel: () => {
      lifetime.current.sequence += 1;
      setBusy(false);
      setCandidate(null);
    },
    confirm: () => {
      if (!candidate) return;
      edit(nextDraft(readCurrentDraft(), candidate));
      setCandidate(null);
    },
  };
}
