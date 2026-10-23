import type { AccountStatus, AccountSummary } from "../../../bindings/generation";
import { invokeHost } from "../../../shared/host/invoke";

export const accountApi = {
  account: () => invokeHost<AccountStatus>("get_account_status"),
  saveKey: (key: string) => invokeHost<AccountStatus>("save_account_key", { key }),
  deleteKey: () => invokeHost<AccountStatus>("delete_account_key"),
  accountSummary: () => invokeHost<AccountSummary | null>("get_account_summary"),
  refreshAccountSummary: () => invokeHost<AccountSummary>("refresh_account_summary"),
};
