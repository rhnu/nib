import { useEffect, useRef, useState } from "react";
import type { CreationOperation, Draft, MaskSession } from "@/bindings/workbench";
import { invokeHost } from "@/shared/host/invoke";
import { errorMessage } from "@/shared/host/error";
import { mediaApi } from "@/features/media/api";
import { renderMaskPng } from "@/features/inpaint/raster";

type Transition = { run: () => void; cancel?: () => void; closeEditor: boolean };
type ApplyConfirmation = { operation: CreationOperation; resolve: (confirmed: boolean) => void };

/** Vector edits belong to the creation; only an explicitly applied PNG enters generation inputs. */
export function useMaskEditor({
  draft,
  readCurrentDraft,
  edit,
  onError,
}: {
  draft: Draft;
  readCurrentDraft: () => Draft;
  edit: (draft: Draft) => void;
  onError: (message: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const setBusy = (value: boolean) => {
    busy.current = value;
    setPending(value);
  };
  const [transition, setTransition] = useState<Transition | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [applyConfirmation, setApplyConfirmation] = useState<ApplyConfirmation | null>(null);
  const lifetime = useRef({ active: true, sequence: 0 });
  const applying = useRef<Promise<boolean> | null>(null);
  useEffect(() => {
    const state = lifetime.current;
    state.active = true;
    return () => {
      state.active = false;
      state.sequence++;
    };
  }, []);
  const active =
    draft.maskEditor.sessions.find(
      (session) => session.sourceAssetId === draft.maskEditor.activeSourceId,
    ) ?? null;
  const currentSession = () => {
    const editor = readCurrentDraft().maskEditor;
    return (
      editor.sessions.find((session) => session.sourceAssetId === editor.activeSourceId) ?? null
    );
  };
  const change = (session: MaskSession) => {
    const current = readCurrentDraft();
    edit({
      ...current,
      maskEditor: {
        ...current.maskEditor,
        sessions: current.maskEditor.sessions.map((item) =>
          item.sourceAssetId === session.sourceAssetId ? session : item,
        ),
      },
    });
  };
  const closeEditor = () => {
    const current = readCurrentDraft();
    if (current.maskEditor.activeSourceId !== null)
      edit({ ...current, maskEditor: { ...current.maskEditor, activeSourceId: null } });
  };
  const discard = () => {
    const current = readCurrentDraft();
    const session = currentSession();
    if (!session) return;
    const operation = current.inputs.operation;
    const maskId =
      operation.kind === "inpainting" && operation.assetId === session.sourceAssetId
        ? operation.maskAssetId
        : session.appliedMaskAssetId;
    change({
      ...session,
      baseMaskAssetId: maskId,
      commands: [],
      cursor: 0,
      revision: 0,
      appliedRevision: 0,
      appliedMaskAssetId: maskId,
    });
  };
  const finish = (target: Transition) => {
    if (target.closeEditor) closeEditor();
    setTransition(null);
    target.run();
  };
  const guard = (run: () => void, options?: { cancel?: () => void; closeEditor?: boolean }) => {
    if (busy.current || transition) {
      options?.cancel?.();
      return;
    }
    const target = { run, cancel: options?.cancel, closeEditor: options?.closeEditor ?? true };
    const session = currentSession();
    if (session && session.revision !== session.appliedRevision) setTransition(target);
    else finish(target);
  };
  async function open(id: string) {
    const sequence = ++lifetime.current.sequence;
    setBusy(true);
    onError("");
    try {
      const asset = await mediaApi.asset(id);
      if (!lifetime.current.active || sequence !== lifetime.current.sequence) return;
      if (!asset.available || asset.width === null || asset.height === null)
        throw new Error("源图不可用。");
      const current = readCurrentDraft();
      const existing = current.maskEditor.sessions.find((item) => item.sourceAssetId === id);
      const operation = current.inputs.operation;
      const maskId =
        operation.kind === "inpainting" && operation.assetId === id ? operation.maskAssetId : null;
      const rebase =
        existing &&
        existing.revision === existing.appliedRevision &&
        maskId &&
        existing.appliedMaskAssetId !== maskId;
      const session: MaskSession =
        existing && !rebase
          ? existing
          : {
              sourceAssetId: id,
              width: asset.width,
              height: asset.height,
              baseMaskAssetId: maskId,
              commands: [],
              cursor: 0,
              revision: 0,
              appliedRevision: 0,
              appliedMaskAssetId: maskId,
              brushSize: existing?.brushSize ?? 32,
              zoom: existing?.zoom ?? 1,
              panX: existing?.panX ?? 0,
              panY: existing?.panY ?? 0,
            };
      edit({
        ...current,
        maskEditor: {
          activeSourceId: id,
          sessions: existing
            ? current.maskEditor.sessions.map((item) =>
                item.sourceAssetId === id ? session : item,
              )
            : [...current.maskEditor.sessions, session],
        },
      });
    } catch (cause) {
      if (lifetime.current.active) onError(errorMessage(cause));
    } finally {
      if (lifetime.current.active && sequence === lifetime.current.sequence) setBusy(false);
    }
  }
  const apply = (): Promise<boolean> => {
    if (applying.current) return applying.current;
    const session = currentSession();
    if (!session) return Promise.resolve(false);
    const snapshot = structuredClone(session);
    setBusy(true);
    onError("");
    applying.current = (async () => {
      try {
        const previousOperation = readCurrentDraft().inputs.operation;
        if (
          previousOperation.kind !== "textToImage" &&
          (previousOperation.kind !== "inpainting" ||
            previousOperation.assetId !== snapshot.sourceAssetId)
        ) {
          const confirmed = await new Promise<boolean>((resolve) =>
            setApplyConfirmation({ operation: previousOperation, resolve }),
          );
          if (!confirmed) return false;
        }
        const png = await renderMaskPng(snapshot);
        const mask = await mediaApi.importImage(
          Array.from(png),
          "mask.png",
          snapshot.sourceAssetId,
        );
        const operation = await invokeHost<CreationOperation>("create_inpaint_operation", {
          id: snapshot.sourceAssetId,
          maskAssetId: mask.id,
        });
        if (!lifetime.current.active) return false;
        const current = readCurrentDraft();
        const latest = current.maskEditor.sessions.find(
          (item) => item.sourceAssetId === snapshot.sourceAssetId,
        );
        if (
          current.maskEditor.activeSourceId !== snapshot.sourceAssetId ||
          !latest ||
          latest.revision !== snapshot.revision
        )
          throw new Error("遮罩已改变，请重新应用。");
        const previous = current.inputs.operation;
        const next =
          operation.kind === "inpainting" &&
          previous.kind === "inpainting" &&
          previous.assetId === snapshot.sourceAssetId
            ? { ...previous, maskAssetId: mask.id }
            : operation;
        edit({
          ...current,
          inputs: { ...current.inputs, operation: next },
          maskEditor: {
            ...current.maskEditor,
            sessions: current.maskEditor.sessions.map((item) =>
              item.sourceAssetId === snapshot.sourceAssetId
                ? { ...item, appliedRevision: snapshot.revision, appliedMaskAssetId: mask.id }
                : item,
            ),
          },
        });
        return true;
      } catch (cause) {
        if (lifetime.current.active) onError(errorMessage(cause));
        return false;
      } finally {
        applying.current = null;
        if (lifetime.current.active) setBusy(false);
      }
    })();
    return applying.current;
  };
  return {
    active,
    pending,
    transition,
    discarding,
    applyConfirmation,
    confirmApply: (confirmed: boolean) => {
      applyConfirmation?.resolve(confirmed);
      setApplyConfirmation(null);
    },
    change,
    guard,
    apply,
    open: (id: string) => {
      if (currentSession()?.sourceAssetId === id) return;
      guard(() => {
        void open(id);
      });
    },
    close: () => guard(() => {}),
    requestClose: async () => {
      if (applying.current && !(await applying.current)) return false;
      return new Promise<boolean>((resolve) =>
        guard(() => resolve(true), { cancel: () => resolve(false), closeEditor: false }),
      );
    },
    cancel: () => {
      if (busy.current) return;
      transition?.cancel?.();
      setTransition(null);
    },
    keep: () => {
      if (transition) finish(transition);
    },
    discardAndContinue: () => {
      if (transition) {
        discard();
        finish(transition);
      }
    },
    applyAndContinue: async () => {
      if (transition && (await apply())) finish(transition);
    },
    requestDiscard: () => setDiscarding(true),
    cancelDiscard: () => setDiscarding(false),
    confirmDiscard: () => {
      discard();
      setDiscarding(false);
    },
  };
}
