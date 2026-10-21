import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { useGenerationData } from "./use-generation-data";
import "./generation.css";

const GenerationContext = createContext<ReturnType<typeof useGenerationData> | null>(null);

export function GenerationProvider({ children }: { children: ReactNode }) {
  const value = useGenerationData();
  return <GenerationContext.Provider value={value}>{children}</GenerationContext.Provider>;
}

export function useGeneration() {
  const value = useContext(GenerationContext);
  if (!value) throw new Error("生成组件需要位于 GenerationProvider 内。");
  return value;
}
