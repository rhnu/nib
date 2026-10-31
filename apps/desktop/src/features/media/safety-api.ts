import type { ImageSafety, ImageTags, ImageAnalysisStatus } from "@/bindings/safety";
import { invokeHost } from "@/shared/host/invoke";

export const safetyApi = {
  status: () => invokeHost<ImageAnalysisStatus>("get_image_analysis_status"),
  get: (assetId: string) => invokeHost<ImageSafety>("get_image_safety", { assetId }),
  rescan: (assetId: string) => invokeHost<ImageSafety>("rescan_image_safety", { assetId }),
  tags: (assetId: string) =>
    invokeHost<ImageTags>("extract_image_tags", {
      assetId,
      generalThreshold: 0,
      characterThreshold: 0,
    }),
};
