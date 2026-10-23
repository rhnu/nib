import { useEffect, useState } from "react";
import type { Resource, WorkspaceSnapshot } from "../bindings/workbench";
import { hasDesktopHost } from "../shared/host/invoke";
import { errorMessage } from "../shared/host/error";
import { workbenchApi } from "../features/workbench/api";
type OpenWorkspace = { snapshot: WorkspaceSnapshot; resources: Map<string, Resource> };
export function useWorkspaceStartup(enabled = true) {
  const [workspace, setWorkspace] = useState<OpenWorkspace | null>(null);
  const [loading, setLoading] = useState(hasDesktopHost);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!hasDesktopHost() || !enabled) return;
    let active = true;
    void workbenchApi
      .workspace()
      .then((snapshot) => {
        if (active) {
          setWorkspace({
            snapshot,
            resources: new Map(snapshot.resources.map((item) => [item.id, item])),
          });
          setLoading(false);
        }
      })
      .catch((cause) => {
        if (active) {
          setError(errorMessage(cause));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [attempt, enabled]);
  return {
    workspace,
    loading,
    error,
    retry: () => {
      setLoading(hasDesktopHost());
      setError("");
      setAttempt((value) => value + 1);
    },
  };
}
