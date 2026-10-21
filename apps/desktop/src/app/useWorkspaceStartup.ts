import { useEffect, useState } from "react";
import type { Resource, WorkspaceSnapshot } from "../bindings/workbench";
import { hasDesktopHost } from "../shared/host/invoke";
import { errorMessage } from "../shared/host/error";
import { workbenchApi } from "../features/workbench/api";
import { libraryApi } from "../features/library/api";
type OpenWorkspace = { snapshot: WorkspaceSnapshot; resources: Map<string, Resource> };
export function useWorkspaceStartup() {
  const [workspace, setWorkspace] = useState<OpenWorkspace | null>(null);
  const [loading, setLoading] = useState(hasDesktopHost);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!hasDesktopHost()) return;
    let active = true;
    void workbenchApi
      .workspace()
      .then(async (snapshot) => {
        const fetched = await Promise.all(
          snapshot.resources.map((item) => libraryApi.resource(item.id)),
        );
        if (active) {
          setWorkspace({ snapshot, resources: new Map(fetched.map((item) => [item.id, item])) });
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
  }, [attempt]);
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
