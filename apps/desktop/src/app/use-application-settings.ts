import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";
import type { ApplicationSettingsSnapshot, StorageLocations } from "@/bindings/settings";
import { errorMessage } from "@/shared/host/error";
import { hasDesktopHost } from "@/shared/host/invoke";
import { PreferencesWriter } from "./preferences-writer";
import { settingsApi } from "./settings-api";
import { prepareSubmissionPreferences } from "./submission-preferences";
import { sameExecutionPreferences } from "./execution-preferences";
import { savedSemanticSearchChanged } from "@/features/lexicon/api";

export function useApplicationSettings() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["application-settings"],
    queryFn: settingsApi.read,
    enabled: hasDesktopHost(),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const [executionVersion, setExecutionVersion] = useState(0);
  const [writer] = useState(
    () =>
      new PreferencesWriter(settingsApi.savePreferences, (saved, previous) => {
        client.setQueryData<ApplicationSettingsSnapshot>(["application-settings"], (snapshot) =>
          snapshot ? { ...snapshot, preferences: saved } : snapshot,
        );
        if (previous && previous.semanticSearchEnabled !== saved.semanticSearchEnabled)
          savedSemanticSearchChanged(saved.semanticSearchEnabled);
        if (previous && !sameExecutionPreferences(previous.execution, saved.execution))
          setExecutionVersion((version) => version + 1);
      }),
  );
  const preferences = useStore(writer.store);
  const storage = query.data?.storage ?? null;
  const [migrationPending, setMigrationPending] = useState(false);
  const directorySave = useRef<Promise<StorageLocations> | null>(null);
  useEffect(() => {
    // A refetch may refresh locations, but the writer exclusively owns loaded edits.
    if (query.data && writer.getSnapshot().value === null)
      writer.initialize(query.data.preferences);
  }, [query.data, writer]);
  const refetchSettings = query.refetch;

  const refreshStorage = useCallback(async () => {
    await refetchSettings();
  }, [refetchSettings]);

  const setDataDirectory = useCallback(
    async (directory: string | null, beforeMigrate?: () => Promise<void>) => {
      if (directorySave.current) return directorySave.current;
      setMigrationPending(true);
      const pending = Promise.resolve().then(async () => {
        await client.cancelQueries({ queryKey: ["application-settings"] });
        await beforeMigrate?.();
        await writer.flush();
        return settingsApi.setDataDirectory(directory);
      });
      directorySave.current = pending;
      try {
        const locations = await pending;
        client.setQueryData<ApplicationSettingsSnapshot>(["application-settings"], (previous) =>
          previous ? { ...previous, storage: locations } : previous,
        );
        return locations;
      } finally {
        directorySave.current = null;
        setMigrationPending(false);
      }
    },
    [writer, client],
  );

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
    migrationPending,
    submissionBlocked:
      migrationPending ||
      Boolean(storage?.restartRequired) ||
      preferences.dirty ||
      preferences.saving ||
      Boolean(preferences.error),
    executionVersion,
    preferences,
    writer,
    storage,
    loading: hasDesktopHost() && query.isPending,
    error: preferences.value === null && query.error ? errorMessage(query.error) : "",
    storageError: preferences.value !== null && query.error ? errorMessage(query.error) : "",
    closeWriter,
    ready: preferences.value !== null,
    retry: () => {
      void query.refetch();
    },
    refreshStorage,
    setDataDirectory,
  };
}

export type ApplicationSettingsState = ReturnType<typeof useApplicationSettings>;
