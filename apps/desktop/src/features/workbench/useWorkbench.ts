import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Draft, Resource, ResourceSummary, WorkspaceSnapshot } from "../../bindings/workbench";
import { useCloseGuard, type CloseWriter } from "../../shared/host/useCloseGuard";
import { errorMessage } from "../../shared/host/error";
import { hasPendingWork, waitForPendingWork } from "../../shared/host/pending-work";
import { useResourceCache } from "../library/useResourceCache";
import type { InsertTarget } from "../library/ResourceLibrary";
import { useResolution } from "../prompt/useResolution";
import { emptySettings } from "../prompt/model";
import { DraftWriter } from "./draft-writer";
import { workbenchApi } from "./api";
import { useGenerationDraft } from "./useGenerationDraft";
export function useWorkbench(
  workspace: WorkspaceSnapshot,
  initialResources: Map<string, Resource>,
  settingsWriter: CloseWriter,
  initialPage: "create" | "settings" = "create",
) {
  const [writer] = useState(() => {
    const value = new DraftWriter<Draft>(workbenchApi.saveDraft);
    value.replace(
      initialPage === "settings" ? { ...workspace.draft, activePage: "settings" } : workspace.draft,
    );
    return value;
  });
  const written = useSyncExternalStore(writer.subscribe, writer.getSnapshot);
  // The writer is initialized before subscription and never clears the live draft.
  const draft = written.value!;
  const { resources, refreshResources, resourceVersion } = useResourceCache(initialResources);
  const generationDraft = useGenerationDraft(draft);
  const resolution = useResolution(generationDraft, resources);
  const [error, setError] = useState("");
  const library = draft.activePage === "library";
  const setLibrary = (open: boolean) => {
    const current = writer.getSnapshot().value!;
    writer.edit({ ...current, activePage: open ? "library" : "create" });
  };
  const [insertTarget, setInsertTarget] = useState<InsertTarget>("positive");
  const [resourceDirty, updateResourceDirty] = useState(false);
  const resourceDirtyRef = useRef(false);
  const setResourceDirty = useCallback((dirty: boolean) => {
    resourceDirtyRef.current = dirty;
    updateResourceDirty(dirty);
  }, []);
  const [restoreVersion, setRestoreVersion] = useState(0);
  const beforeClose = useRef<() => Promise<boolean>>(async () => true);
  const setBeforeClose = (callback: () => Promise<boolean>) => {
    beforeClose.current = callback;
  };
  const closeWriter = useMemo(
    () => ({
      getSnapshot: () => ({
        dirty: hasPendingWork() || writer.getSnapshot().dirty || settingsWriter.getSnapshot().dirty,
      }),
      flush: async () => {
        do {
          await waitForPendingWork();
          await settingsWriter.flush();
          await writer.flush();
        } while (
          hasPendingWork() ||
          settingsWriter.getSnapshot().dirty ||
          writer.getSnapshot().dirty
        );
      },
    }),
    [writer, settingsWriter],
  );
  useCloseGuard({
    writer: closeWriter,
    resourceDirty,
    getResourceDirty: () => resourceDirtyRef.current,
    onResourceBlocked: () => {
      setError("资源中有未保存的修改。请先保存资源，再关闭窗口。");
      setLibrary(true);
    },
    onError: setError,
    beforeClose: () => beforeClose.current(),
  });
  const edit = (value: Draft) => writer.edit(value);
  const readCurrentDraft = () => writer.getSnapshot().value!;
  const restore = (value: Draft) => {
    setRestoreVersion((version) => version + 1);
    const current = readCurrentDraft();
    writer.edit({
      ...value,
      revision: current.revision,
      maskEditor: current.maskEditor,
      vibeEncoder: current.vibeEncoder,
      director: current.director,
      pngTextEditor: current.pngTextEditor,
      activePage: value.activePage,
    });
  };
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
            binding: {
              kind: "linked",
              resourceId: resource.id,
              overrides: [],
              settingsOverrides: emptySettings(),
              outputOverrides: {
                characters: [],
                precise: [],
                vibes: [],
                normalizeVibeStrength: null,
              },
            },
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
    setBeforeClose,
    written,
    draft,
    generationDraft,
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
    restoreVersion,
    readCurrentDraft,
    openLibrary,
    insert,
  };
}
