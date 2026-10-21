import { invoke } from "@tauri-apps/api/core";
import type { AppInfo } from "./bindings/app-info";

/** Read startup information from the desktop host. */
export function getAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("get_app_info");
}
