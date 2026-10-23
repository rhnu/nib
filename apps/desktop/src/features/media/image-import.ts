import type { MediaAsset } from "../../bindings/media";
import { trackPendingWork } from "../../shared/host/pending-work";
import { imageUnavailableReason } from "./model";

/** Imported content remains pending through the receiving editor's final commit. */
export function importAndCommitImage({
  file,
  importImage,
  commit,
  isCurrent,
}: {
  file: Pick<File, "name" | "arrayBuffer">;
  importImage: (bytes: number[], name: string) => Promise<MediaAsset>;
  commit: (asset: MediaAsset) => void | Promise<void>;
  isCurrent: () => boolean;
}): Promise<void> {
  return trackPendingWork(
    (async () => {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      if (!isCurrent()) return;
      const asset = await importImage(bytes, file.name);
      if (!isCurrent()) return;
      const reason = imageUnavailableReason(asset);
      if (reason) throw new Error(reason);
      await commit(asset);
    })(),
  );
}
