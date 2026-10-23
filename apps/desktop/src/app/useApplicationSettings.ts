import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { StorageLocations } from "../bindings/settings";
import { errorMessage } from "../shared/host/error";
import { hasDesktopHost } from "../shared/host/invoke";
import { PreferencesWriter } from "./preferences-writer";
import { settingsApi } from "./settings-api";
import { prepareSubmissionPreferences } from "./submission-preferences";

export function useApplicationSettings() {
  const [executionVersion, setExecutionVersion] = useState(0);
  const [writer] = useState(
    () =>
      new PreferencesWriter(settingsApi.savePreferences, (saved, previous) => {
        if (
          previous &&
          (previous.execution.imageRequestEncoding !== saved.execution.imageRequestEncoding ||
            previous.execution.serverImageCache !== saved.execution.serverImageCache)
        )
          setExecutionVersion((version) => version + 1);
      }),
  );
  const preferences = useSyncExternalStore(writer.subscribe, writer.getSnapshot);
  const [storage, setStorage] = useState<StorageLocations | null>(null);
  const [loading, setLoading] = useState(hasDesktopHost);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const directorySave = useRef<Promise<StorageLocations> | null>(null);
  const storageVersion = useRef(0);
  useEffect(() => {
    if (!hasDesktopHost()) return;
    let active = true;
    void settingsApi
      .read()
      .then((snapshot) => {
        if (!active) return;
        writer.initialize(snapshot.preferences);
        setStorage(snapshot.storage);
        setLoading(false);
      })
      .catch((cause) => {
        if (!active) return;
        setError(errorMessage(cause));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt, writer]);
  const refreshStorage = useCallback(async () => {
    const version = ++storageVersion.current;
    try {
      const snapshot = await settingsApi.read();
      if (version !== storageVersion.current) return;
      setStorage(snapshot.storage);
      setStorageError("");
    } catch (cause) {
      if (version !== storageVersion.current) return;
      setStorageError(errorMessage(cause));
    }
  }, []);
  const setDataDirectory = useCallback(async (directory: string | null) => {
    if (directorySave.current) return directorySave.current;
    storageVersion.current++;
    const pending = settingsApi.setDataDirectory(directory);
    directorySave.current = pending;
    try {
      const locations = await pending;
      storageVersion.current++;
      setStorage(locations);
      setStorageError("");
      return locations;
    } finally {
      directorySave.current = null;
    }
  }, []);
  const closeWriter = useMemo(
    () => ({
      getSnapshot: () => ({ dirty: writer.getSnapshot().dirty || directorySave.current !== null }),
      flush: async () => {
        do {
          const pendingDirectory = directorySave.current;
          await pendingDirectory;
          await writer.flush();
        } while (writer.getSnapshot().dirty || directorySave.current !== null);
      },
    }),
    [writer],
  );
  const prepareSubmission = useCallback(() => prepareSubmissionPreferences(writer), [writer]);
  return {
    prepareSubmission,
    submissionBlocked: preferences.dirty || preferences.saving || Boolean(preferences.error),
    executionVersion,
    preferences,
    writer,
    storage,
    loading,
    error,
    storageError,
    closeWriter,
    ready: preferences.value !== null,
    retry: () => {
      setLoading(hasDesktopHost());
      setError("");
      setAttempt((value) => value + 1);
    },
    refreshStorage,
    setDataDirectory,
  };
}

export type ApplicationSettingsState = ReturnType<typeof useApplicationSettings>;
