import type { ImageMetadataReport, MediaAsset, MetadataRestore } from "../../bindings/media";
import { invokeHost } from "../../shared/host/invoke";

export const mediaApi = {
  assets: () => invokeHost<MediaAsset[]>("list_media_assets"),
  asset: (id: string) => invokeHost<MediaAsset>("get_media_asset", { id }),
  importImage: (bytes: number[], name: string | null = null, sourceAssetId: string | null = null) =>
    invokeHost<MediaAsset>("import_image_asset", { bytes, name, sourceAssetId }),
  importVibe: (bytes: number[], name: string | null = null) =>
    invokeHost<MediaAsset>("import_vibe_asset", { bytes, name }),
  content: (id: string) => invokeHost<ArrayBuffer>("read_media_asset", { id }),
  metadata: (id: string) => invokeHost<ImageMetadataReport>("inspect_image_metadata", { id }),
  embeddedVibes: (id: string) => invokeHost<MediaAsset[]>("import_embedded_vibes", { id }),
  restoreMetadata: (id: string) => invokeHost<MetadataRestore>("restore_image_metadata", { id }),
};
