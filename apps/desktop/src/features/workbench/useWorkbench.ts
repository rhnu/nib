import { useState, useSyncExternalStore } from "react";
import type { Draft, Resource, ResourceSummary, WorkspaceSnapshot } from "../../bindings/workbench";
import { useCloseGuard } from "../../shared/host/useCloseGuard";
import { errorMessage } from "../../shared/host/error";
import { useResourceCache } from "../library/useResourceCache";
import type { InsertTarget } from "../library/ResourceLibrary";
import { useResolution } from "../prompt/useResolution";
import { DraftWriter } from "./draft-writer";
import { workbenchApi } from "./api";
export function useWorkbench(
  workspace: WorkspaceSnapshot,
  initialResources: Map<string, Resource>,
) {
  const [writer] = useState(() => {
    const value = new DraftWriter<Draft>(workbenchApi.saveDraft);
    value.replace(workspace.draft);
    return value;
  });
  const written = useSyncExternalStore(writer.subscribe, writer.getSnapshot);
  // The writer is initialized before subscription and never clears the live draft.
  const draft = written.value!;
  const { resources, refreshResources, resourceVersion } = useResourceCache(initialResources);
  const resolution = useResolution(draft, resources);
  const [error, setError] = useState("");
  const [library, setLibrary] = useState(false);
  const [insertTarget, setInsertTarget] = useState<InsertTarget>("positive");
  const [resourceDirty, setResourceDirty] = useState(false);
  useCloseGuard({
    writer,
    resourceDirty,
    onResourceBlocked: () => {
      setError("资源中有未保存的修改。请先保存资源，再关闭窗口。");
      setLibrary(true);
    },
    onError: setError,
  });
  const edit = (value: Draft) => writer.edit(value);
  const readCurrentDraft = () => writer.getSnapshot().value!;
  const restore = (value: Draft) =>
    writer.edit({ ...value, revision: readCurrentDraft().revision });
  const openLibrary = (target: InsertTarget) => {
    setInsertTarget(target);
    setLibrary(true);
  };
  const insert = (resource: ResourceSummary) => {
    const current = readCurrentDraft();
    if (resource.kind === "preset")
      edit({
        ...current,
        presets: [
          ...current.presets,
          {
            id: crypto.randomUUID(),
            enabled: true,
            binding: { kind: "linked", resourceId: resource.id, overrides: [] },
          },
        ],
      });
    else {
      const scope = insertTarget === "negative" ? "negative" : "positive";
      edit({
        ...current,
        composition: {
          ...current.composition,
          [scope]: [
            ...current.composition[scope],
            {
              kind: "chunk",
              id: crypto.randomUUID(),
              resourceId: resource.id,
              enabled: true,
              overrideText: null,
            },
          ],
        },
      });
    }
    if (!resources.has(resource.id))
      void refreshResources().catch((cause) => setError(errorMessage(cause)));
  };
  return {
    writer,
    written,
    draft,
    resources,
    refreshResources,
    resourceVersion,
    ...resolution,
    error,
    setError,
    library,
    setLibrary,
    insertTarget,
    setResourceDirty,
    edit,
    restore,
    readCurrentDraft,
    openLibrary,
    insert,
  };
}
