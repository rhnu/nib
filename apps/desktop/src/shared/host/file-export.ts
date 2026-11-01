import { invokeHost } from "./invoke";
import { trackPendingWork } from "./pending-work";

/** The host owns both destination selection and writing; false means the dialog was cancelled. */
export function saveExportFile(bytes: ArrayBuffer, filename: string): Promise<boolean> {
  return trackPendingWork(
    invokeHost<boolean>("save_export_file", {
      filename,
      bytes: Array.from(new Uint8Array(bytes)),
    }),
  );
}
