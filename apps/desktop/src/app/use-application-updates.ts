import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { UpdateStatus } from "@/bindings/updates";
import { invokeHost, hasDesktopHost } from "@/shared/host/invoke";
import type { ExitPreparation } from "@/shared/host/exit-preparation";
import { queryClient } from "@/shared/query/client";
import { useMessageState } from "@/shared/i18n";

const statusKey = ["application-update"] as const;

/** Application lifetime owns the check and download; routed settings only display this state. */
export function useApplicationUpdates(preparation: ExitPreparation) {
  const [open, setOpen] = useState(false);
  const [operation, setOperation] = useState<"checking" | "downloading" | "preparing" | null>(null);
  const [installing, setInstalling] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useMessageState();
  const automaticStarted = useRef(false);
  const operating = useRef(false);
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => invokeHost<UpdateStatus>("get_update_status"),
    enabled: hasDesktopHost(),
    staleTime: Infinity,
    refetchInterval: (query) => {
      const phase = query.state.data?.phase;
      return operation || phase === "downloading" || phase === "installing" ? 500 : false;
    },
  });

  const accept = (value: UpdateStatus) => queryClient.setQueryData(statusKey, value);

  const check = async (automatic = false) => {
    if (operating.current) return;
    operating.current = true;
    setOperation("checking");
    setError("");
    try {
      const value = await invokeHost<UpdateStatus>("check_for_update");
      accept(value);
      setChecked(true);
      if (value.release) setOpen(true);
    } catch (cause) {
      if (!automatic) setError(cause);
    } finally {
      operating.current = false;
      setOperation(null);
      void status.refetch();
    }
  };

  useEffect(() => {
    if (!status.data?.enabled || automaticStarted.current) return;
    automaticStarted.current = true;
    void check(true);
  });

  const install = async (download: boolean) => {
    if (operating.current) return;
    operating.current = true;
    setError("");
    try {
      if (download) {
        setOperation("downloading");
        accept(await invokeHost<UpdateStatus>("download_update"));
      }
      setOperation("preparing");
      // Let resource navigation and mask decision dialogs use their normal focus/interaction.
      setOpen(false);
      if (!(await preparation.run())) return;
      setInstalling(true);
      // After freezing editing, flush any work added during the first preparation.
      if (!(await preparation.run())) return;
      await invokeHost("install_update");
    } catch (cause) {
      setError(cause);
      setOpen(true);
    } finally {
      setInstalling(false);
      setOperation(null);
      operating.current = false;
      void status.refetch();
    }
  };

  return {
    status: status.data,
    error: error || status.error || status.data?.error,
    open,
    setOpen,
    operation,
    checked,
    installing,
    check: () => check(),
    install: () => install(status.data?.phase !== "ready"),
  };
}

export type ApplicationUpdates = ReturnType<typeof useApplicationUpdates>;
