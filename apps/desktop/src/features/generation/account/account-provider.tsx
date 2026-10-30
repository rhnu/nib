import type { ReactNode } from "react";
import { AccountContext } from "./account-context";
import { useAccountData } from "./use-account-data";

export function AccountProvider({
  executionVersion,
  children,
}: {
  executionVersion: number;
  children: ReactNode;
}) {
  const account = useAccountData(executionVersion);
  return <AccountContext value={account}>{children}</AccountContext>;
}
