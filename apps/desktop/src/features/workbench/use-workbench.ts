import { useMessageState, deferMessage, t, MessageError } from "@/shared/i18n";
import { useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type {
  Draft,
  DraftSnapshot,
  Resource,
  ResourceSummary,
  WorkspaceSnapshot,
} from "@/bindings/workbench";
import { useCloseGuard, type CloseWriter } from "@/shared/host/use-close-guard";
import { hasPendingWork, waitForPendingWork } from "@/shared/host/pending-work";
import { notify } from "@/shared/ui";
import { useResourceCache } from "@/features/library/use-resource-cache";
import { useResolution, type ResolutionEvaluation } from "@/features/prompt/use-resolution";
import { emptySettings } from "@/features/prompt/model";
import { DraftWriter } from "./draft-writer";
import { DraftPersistence } from "./api";
import { useGenerationDraft } from "@/features/inputs/use-generation-draft";
import { createLibrarySessionStore } from "@/features/library/model/library-session";
import { createLexiconSessionStore } from "@/features/lexicon/lexicon-session";

export function useWorkbench(
  workspace: WorkspaceSnapshot,
  initialResources: Map<string, Resource>,
  settingsWriter: CloseWriter,
  navigate: (page: Draft["activePage"]) => void,
  evaluation: ResolutionEvaluation,
) {
  const [draftAuthority] = useState(() => new DraftPersistence(workspace.draftEpoch));
  const [writer] = useState(() => {
    const value = new DraftWriter<Draft>(draftAuthority.save);
    value.replace(workspace.draft);
    value.setEditingLocked(true);
    return value;
  });
  const written = useStore(writer.store);
  // The writer is initialized before subscription and never clears the live draft.
  const draft = written.value!;
  const {
    resources,
    refreshResources,
    resourceVersion,
    resourceError,
    ensureResources,
    retryResources,
  } = useResourceCache(initialResources, draft);
  const generationDraft = useGenerationDraft(draft);
  const resolution = useResolution(generationDraft, resourceVersion, evaluation);
  const [error, setError] = useMessageState();
  const [librarySession] = useState(createLibrarySessionStore);
  const [lexiconSession] = useState(createLexiconSessionStore);
  const resourceDirty = useStore(librarySession, (value) => value.dirty || value.busy);

  const getResourceDirty = () => librarySession.getState().dirty || librarySession.getState().busy;

  const [restoreVersion, setRestoreVersion] = useState(0);

  const acceptDraftSnapshot = (snapshot: DraftSnapshot) => {
    writer.replace(snapshot.draft);
    draftAuthority.accept(snapshot);
    setRestoreVersion((version) => version + 1);
  };

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
    getResourceDirty,
    onResourceBlocked: () => {
      setError(deferMessage(() => t("workbench.saveResourcesBeforeClose")));
      navigate("library");
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
      maskEditor: current.maskEditor,
      vibeEncoder: current.vibeEncoder,
      director: current.director,
      pngTextEditor: current.pngTextEditor,
      activePage: current.activePage,
    });
  };

  const insertPreset = (resource: ResourceSummary) => {
    writer.update((current) => {
      current.presets.push({
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
      });
    });
    if (!resources.has(resource.id))
      void ensureResources([resource.id]).catch((cause) => setError(cause));
    notify(() => t("library.resourceInserted", { name: resource.name }));
  };

  const prepareMigration = async () => {
    if (getResourceDirty()) {
      navigate("library");
      const message = new MessageError(
        deferMessage(() => t("workbench.saveResourcesBeforeMigration")),
      );
      setError(message);
      throw message;
    }
    do {
      await waitForPendingWork();
      await writer.flush();
    } while (hasPendingWork() || writer.getSnapshot().dirty);
    if (getResourceDirty())
      throw new MessageError(deferMessage(() => t("workbench.saveResourcesBeforeRetry")));
  };

  return {
    writer,
    acceptDraftSnapshot,
    readDraftEpoch: () => draftAuthority.readEpoch(),
    prepareMigration,
    setBeforeClose,
    written,
    draft,
    generationDraft,
    resources,
    refreshResources,
    ensureResources,
    resourceError,
    retryResources,
    resourceVersion,
    ...resolution,
    error,
    setError,
    librarySession,
    lexiconSession,
    edit,
    restore,
    restoreVersion,
    readCurrentDraft,
    insertPreset,
  };
}
