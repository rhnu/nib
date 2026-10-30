import { deferMessage, t, MessageError } from "@/shared/i18n";
import { createContext, useContext } from "react";
import type { useWorkbenchController } from "./use-workbench-controller";

export type WorkbenchController = ReturnType<typeof useWorkbenchController>;
export const WorkbenchContext = createContext<WorkbenchController | null>(null);

export function useWorkbenchContext() {
  const context = useContext(WorkbenchContext);
  if (!context) throw new MessageError(deferMessage(() => t("workbench.missingContext")));
  return context;
}
