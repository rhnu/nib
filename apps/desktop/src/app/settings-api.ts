import type {
  ApplicationPreferences,
  ApplicationSettingsSnapshot,
  StorageLocations,
} from "../bindings/settings";
import { invokeHost } from "../shared/host/invoke";

export const settingsApi = {
  read: () => invokeHost<ApplicationSettingsSnapshot>("get_application_settings"),
  savePreferences: (preferences: ApplicationPreferences) =>
    invokeHost<ApplicationPreferences>("save_application_preferences", { preferences }),
  setDataDirectory: (directory: string | null) =>
    invokeHost<StorageLocations>("set_data_directory", { directory }),
};
