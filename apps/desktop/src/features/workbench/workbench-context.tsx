import { createContext, useContext } from "react";
import type { useWorkbenchController } from "./use-workbench-controller";

export type WorkbenchController = ReturnType<typeof useWorkbenchController>;
export const WorkbenchContext = createContext<WorkbenchController | null>(null);

export function useWorkbenchContext() {
  const context = useContext(WorkbenchContext);
  if (!context) throw new Error("Workbench context is missing.");
  return context;
}
