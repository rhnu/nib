import { createContext, useContext } from "react";
import type { MediaAsset } from "@/bindings/media";
import type { Draft } from "@/bindings/workbench";
import type { ImageOperationAction } from "@/features/inputs/image-operation";

/** Image tools share the current workspace's navigation and persistent editing state. */
export const MediaToolsContext = createContext<{
  onDirector: (assetId: string) => void;
  onPngText: (asset: MediaAsset) => void;
  onImageOperation: (assetId: string, kind: ImageOperationAction) => void;
  onRestore: (draft: Draft) => void;
  canMaxEnhance: boolean;
  canInpaint: boolean;
} | null>(null);

export const useMediaTools = () => useContext(MediaToolsContext);
