import type {
  ImageMetadataReport,
  MediaAsset,
  MetadataRestore,
  VibeAssetInspection,
  VibeDocumentInspection,
} from "../../bindings/media";
import type { VibeEncodingInput, VibeReferenceInput } from "../../bindings/workbench";
import { invokeHost } from "../../shared/host/invoke";

export const mediaApi = {
  assets: () => invokeHost<MediaAsset[]>("list_media_assets"),
  asset: (id: string) => invokeHost<MediaAsset>("get_media_asset", { id }),
  importImage: (bytes: number[], name: string | null = null, sourceAssetId: string | null = null) =>
    invokeHost<MediaAsset>("import_image_asset", { bytes, name, sourceAssetId }),
  importVibe: (bytes: number[], name: string | null = null) =>
    invokeHost<MediaAsset>("import_vibe_asset", { bytes, name }),
  importVibeDocument: (bytes: number[], name: string | null = null) =>
    invokeHost<MediaAsset>("import_vibe_document", { bytes, name }),
  createImageVibeDocument: (imageId: string) =>
    invokeHost<MediaAsset>("create_image_vibe_document", { imageId }),
  createEncodedVibeDocument: (vibeId: string) =>
    invokeHost<MediaAsset>("create_encoded_vibe_document", { vibeId }),
  inspectVibeDocument: (id: string) =>
    invokeHost<VibeDocumentInspection>("inspect_vibe_document", { id }),
  inspectVibeAsset: (id: string) => invokeHost<VibeAssetInspection>("inspect_vibe_asset", { id }),
  prepareVibeReencoding: (id: string) =>
    invokeHost<VibeEncodingInput>("prepare_vibe_reencoding", { id }),
  createVibeReference: (id: string) =>
    invokeHost<VibeReferenceInput>("create_vibe_reference", {
      id,
      referenceId: crypto.randomUUID(),
      strength: 1,
    }),
  bundleVibeDocuments: (documentIds: string[]) =>
    invokeHost<MediaAsset>("bundle_vibe_documents", { documentIds }),
  importPngVibeDocument: (imageId: string) =>
    invokeHost<MediaAsset | null>("import_png_vibe_document", { imageId }),
  exportVibeDocument: (id: string) => invokeHost<ArrayBuffer>("export_vibe_document", { id }),
  embedVibeDocument: (documentId: string, imageId: string) =>
    invokeHost<MediaAsset>("embed_vibe_document", { documentId, imageId }),
  writePngText: (imageId: string, entries: [string, string][]) =>
    invokeHost<MediaAsset>("write_png_text", { imageId, entries }),
  importDocumentImage: (documentId: string, entryIndex: number) =>
    invokeHost<MediaAsset>("import_document_image", { documentId, entryIndex }),
  importDocumentEncoding: (
    documentId: string,
    entryIndex: number,
    modelKey: string,
    parameterKey: string,
  ) =>
    invokeHost<MediaAsset>("import_document_encoding", {
      documentId,
      entryIndex,
      modelKey,
      parameterKey,
    }),
  content: (id: string) => invokeHost<ArrayBuffer>("read_media_asset", { id }),
  metadata: (id: string) => invokeHost<ImageMetadataReport>("inspect_image_metadata", { id }),
  embeddedVibes: (id: string) => invokeHost<MediaAsset[]>("import_embedded_vibes", { id }),
  restoreMetadata: (id: string) => invokeHost<MetadataRestore>("restore_image_metadata", { id }),
};
