import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AgentConnectionConfig, AgentConnectionStatus, AgentSnapshot } from "@/bindings/agent";
import type { WorkbenchController } from "@/features/workbench/workbench-context";
import type { Draft } from "@/bindings/workbench";
import { workbenchApi } from "@/features/workbench/api";
import { dismissLibraryResource } from "@/features/library/model/library-session";
import { hasPendingWork, waitForPendingWork } from "@/shared/host/pending-work";
import { MessageError, deferMessage, t } from "@/shared/i18n";
import { agentApi } from "./api";

export type AgentPhase = "checking" | "ready" | "preparing" | "running" | "synchronizing";

/** Own takeover and reconciliation above page and panel lifetimes. */
export function useAgent({
  controller,
  onLock,
  onRunning,
  readOnly,
}: {
  controller: WorkbenchController;
  onLock: (locked: boolean) => void;
  onRunning: () => void;
  readOnly: boolean;
}) {
  const client = useQueryClient();
  const [snapshot, setSnapshot] = useState<AgentSnapshot | null>(null);
  const [connection, setConnection] = useState<AgentConnectionStatus | null>(null);
  const [phase, setPhase] = useState<AgentPhase>("checking");
  const [error, setError] = useState<unknown>(null);
  const [pollError, setPollError] = useState<unknown>(null);
  const [cancelling, setCancelling] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [undoDraft, setUndoDraft] = useState<Draft | null>(null);
  const latest = useRef({ controller, onLock, readOnly, onRunning });
  useLayoutEffect(() => {
    latest.current = { controller, onLock, readOnly, onRunning };
  });
  const runtime = useRef({
    phase: "checking" as AgentPhase,
    busy: false,
    polling: false,
    cancelled: false,
    snapshot: null as AgentSnapshot | null,
    active: true,
    requestVersion: 0,
  });

  const changePhase = useCallback((next: AgentPhase) => {
    runtime.current.phase = next;
    setPhase(next);
    latest.current.onLock(next !== "ready");
  }, []);

  const refreshResources = useCallback(async () => {
    const state = latest.current.controller.state;
    await client.cancelQueries({ queryKey: ["resource"] });
    await client.invalidateQueries({ queryKey: ["resource"], refetchType: "none" });
    await state.ensureResources([...state.resources.keys()], true);
    await Promise.all(
      ["resource-folders", "resource-tags", "resource-search", "draft-analysis", "quote"].map(
        (key) => client.invalidateQueries({ queryKey: [key] }),
      ),
    );
    // Clean editors may contain old definitions after a tool changed or removed a resource.
    dismissLibraryResource(state.librarySession);
  }, [client]);

  const reconcile = useCallback(async () => {
    changePhase("synchronizing");
    const current = await workbenchApi.draftSnapshot();
    if (current.owner !== null) {
      changePhase("running");
      return false;
    }
    const state = latest.current.controller.state;
    state.acceptDraftSnapshot(current);
    setUndoDraft(current.undoAvailable ? current.draft : null);
    await refreshResources();
    state.writer.setEditingLocked(false);
    changePhase("ready");
    return true;
  }, [changePhase, refreshResources]);

  const refresh = useCallback(async () => {
    const run = runtime.current;
    if (run.busy || run.polling) return;
    run.polling = true;
    let ownsOperation = false;
    const requestVersion = run.requestVersion;
    try {
      const next = await agentApi.state();
      if (!run.active || run.busy || run.requestVersion !== requestVersion) return;
      const previous = run.snapshot;
      run.snapshot = next;
      setSnapshot(next);
      if (next.status === "running") {
        latest.current.controller.state.writer.setEditingLocked(true);
        setUndoDraft(null);
        if (previous?.status !== "running") latest.current.onRunning();
        changePhase("running");
      } else if (run.phase !== "ready" || previous?.runId !== next.runId) {
        // Reserve the reconciliation so a send cannot overlap its authoritative read.
        run.busy = true;
        ownsOperation = true;
        latest.current.controller.state.writer.setEditingLocked(true);
        const synchronized = await reconcile();
        if (synchronized) {
          setCancelling(false);
          run.cancelled = false;
        }
      }
      setPollError(null);
    } catch (cause) {
      if (run.active && run.requestVersion === requestVersion) {
        setPollError(cause);
        if (!run.busy && run.phase !== "ready") {
          // Conversation storage may fail independently; draft ownership still decides edit access.
          run.busy = true;
          ownsOperation = true;
          try {
            await reconcile();
          } catch (syncError) {
            setPollError(syncError);
          }
        }
      }
    } finally {
      if (ownsOperation) run.busy = false;
      run.polling = false;
    }
  }, [changePhase, reconcile]);

  useEffect(() => {
    const run = runtime.current;
    run.active = true;
    let listening = true;
    latest.current.controller.state.writer.setEditingLocked(true);
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      await refresh();
      if (listening) timer = setTimeout(() => void poll(), run.phase === "ready" ? 2500 : 400);
    };

    void poll();
    void agentApi.connection().then(
      (value) => {
        if (listening) setConnection(value);
      },
      (cause: unknown) => {
        if (listening) setError(cause);
      },
    );
    return () => {
      run.active = false;
      listening = false;
      clearTimeout(timer);
    };
  }, [refresh]);

  const start = async (prompt: string) => {
    const run = runtime.current;
    if (run.busy || run.phase !== "ready") return false;
    if (latest.current.readOnly) {
      setError(new MessageError(deferMessage(() => t("agent.readOnly"))));
      return false;
    }
    run.busy = true;
    run.requestVersion++;
    run.cancelled = false;
    setCancelling(false);
    setError(null);
    setUndoDraft(null);
    changePhase("preparing");
    let startAttempted = false;
    const { state } = latest.current.controller;
    try {
      const initialResource = state.librarySession.getState();
      if (initialResource.dirty && !initialResource.busy)
        throw new MessageError(deferMessage(() => t("agent.saveResourcesFirst")));
      do {
        await waitForPendingWork();
        await latest.current.controller.options.settingsWriter.flush();
        await state.writer.flush();
      } while (
        hasPendingWork() ||
        latest.current.controller.options.settingsWriter.getSnapshot().dirty ||
        state.writer.getSnapshot().dirty
      );
      if (run.cancelled) {
        setCancelling(false);
        changePhase("ready");
        return false;
      }
      const resource = state.librarySession.getState();
      if (resource.dirty) throw new MessageError(deferMessage(() => t("agent.saveResourcesFirst")));
      if (resource.busy) throw new MessageError(deferMessage(() => t("agent.resourcesBusy")));
      state.writer.setEditingLocked(true);
      startAttempted = true;
      let next = await agentApi.start(prompt, state.readDraftEpoch());
      // Cancellation may arrive while the start IPC is establishing backend ownership.
      if (run.cancelled) next = await agentApi.cancel();
      run.snapshot = next;
      setSnapshot(next);
      changePhase("running");
      return true;
    } catch (cause) {
      setError(cause);
      if (startAttempted) {
        // An IPC failure can follow an accepted run; only the backend may release ownership.
        changePhase("checking");
      } else {
        state.writer.setEditingLocked(false);
        changePhase("ready");
      }
      return false;
    } finally {
      run.busy = false;
      if (!run.cancelled) setCancelling(false);
    }
  };

  const cancel = async () => {
    const run = runtime.current;
    run.requestVersion++;
    if (run.phase === "preparing") {
      run.cancelled = true;
      setCancelling(true);
      return;
    }
    setCancelling(true);
    run.cancelled = true;
    setError(null);
    try {
      const next = await agentApi.cancel();
      run.snapshot = next;
      setSnapshot(next);
    } catch (cause) {
      setError(cause);
      run.cancelled = false;
      setCancelling(false);
    }
  };

  const saveConnection = async (config: AgentConnectionConfig, apiKey: string | null) => {
    setConnectionBusy(true);
    setError(null);
    try {
      setConnection(await agentApi.saveConnection(config, apiKey));
      return true;
    } catch (cause) {
      setError(cause);
      return false;
    } finally {
      setConnectionBusy(false);
    }
  };

  const clear = async () => {
    if (runtime.current.busy || runtime.current.phase !== "ready") return;
    runtime.current.busy = true;
    runtime.current.requestVersion++;
    try {
      const next = await agentApi.clear();
      runtime.current.snapshot = next;
      setSnapshot(next);
      setError(null);
    } catch (cause) {
      setError(cause);
    } finally {
      runtime.current.busy = false;
    }
  };

  const undo = async () => {
    const run = runtime.current;
    if (run.busy || run.phase !== "ready" || latest.current.readOnly) return;
    run.busy = true;
    run.requestVersion++;
    setError(null);
    changePhase("synchronizing");
    const { state } = latest.current.controller;
    let attempted = false;
    try {
      await waitForPendingWork();
      if (state.writer.getSnapshot().dirty || state.librarySession.getState().dirty)
        throw new MessageError(deferMessage(() => t("agent.saveResourcesFirst")));
      state.writer.setEditingLocked(true);
      attempted = true;
      const current = await agentApi.undo(state.readDraftEpoch());
      state.acceptDraftSnapshot(current);
      await refreshResources();
      setUndoDraft(null);
      state.writer.setEditingLocked(false);
      changePhase("ready");
    } catch (cause) {
      setError(cause);
      if (attempted) changePhase("checking");
      else {
        state.writer.setEditingLocked(false);
        changePhase("ready");
      }
    } finally {
      run.busy = false;
    }
  };

  const undoResources = async () => {
    const run = runtime.current;
    if (run.busy || run.phase !== "ready" || latest.current.readOnly) return;
    run.busy = true;
    run.requestVersion++;
    setError(null);
    changePhase("synchronizing");
    const { state } = latest.current.controller;
    let attempted = false;
    try {
      await waitForPendingWork();
      if (state.writer.getSnapshot().dirty || state.librarySession.getState().dirty)
        throw new MessageError(deferMessage(() => t("agent.saveResourcesFirst")));
      state.writer.setEditingLocked(true);
      attempted = true;
      const next = await agentApi.undoResources();
      run.snapshot = next;
      setSnapshot(next);
      await reconcile();
    } catch (cause) {
      setError(cause);
      // Keep ownership checks authoritative even if the undo reply was interrupted.
      if (attempted) changePhase("checking");
      else {
        state.writer.setEditingLocked(false);
        changePhase("ready");
      }
    } finally {
      run.busy = false;
    }
  };

  const retry = async () => {
    await refresh();
    try {
      setConnection(await agentApi.connection());
      setError(null);
    } catch (cause) {
      setError(cause);
    }
  };

  return {
    snapshot,
    connection,
    connectionBusy,
    phase,
    error: error ?? pollError,
    cancelling,
    undoAvailable: undoDraft !== null && undoDraft === controller.state.written.value,
    start,
    cancel,
    saveConnection,
    clear,
    undo,
    undoResources,
    retry,
  };
}

export type AgentController = ReturnType<typeof useAgent>;
