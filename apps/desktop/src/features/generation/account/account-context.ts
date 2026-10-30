import { t, MessageError, deferMessage } from "@/shared/i18n";
import { createContext, useContext } from "react";
import type { useAccountData } from "./use-account-data";

export const AccountContext = createContext<ReturnType<typeof useAccountData> | null>(null);

export function useAccount() {
  const value = useContext(AccountContext);
  if (!value) throw new MessageError(deferMessage(() => t("generation.accountProviderRequired")));
  return value;
}
