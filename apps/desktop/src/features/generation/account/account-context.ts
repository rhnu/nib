import { createContext, useContext } from "react";
import type { useAccountData } from "./use-account-data";

export const AccountContext = createContext<ReturnType<typeof useAccountData> | null>(null);

export function useAccount() {
  const value = useContext(AccountContext);
  if (!value) throw new Error("账户组件需要位于 GenerationProvider 内。");
  return value;
}
