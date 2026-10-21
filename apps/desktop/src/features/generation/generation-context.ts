import { createContext, useContext } from "react";
import type { useGenerationData } from "./use-generation-data";

export const GenerationContext = createContext<ReturnType<typeof useGenerationData> | null>(null);

export function useGeneration() {
  const value = useContext(GenerationContext);
  if (!value) throw new Error("生成组件需要位于 GenerationProvider 内。");
  return value;
}
