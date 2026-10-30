import { createContext, useContext } from "react";
import type { MediaAsset } from "@/bindings/media";

/** Image tools share the current workspace's navigation and persistent editing state. */
export const MediaToolsContext = createContext<{
  onDirector: (assetId: string) => void;
  onPngText: (asset: MediaAsset) => void;
} | null>(null);

export const useMediaTools = () => useContext(MediaToolsContext);
