import type { AccountStatus, AccountSnapshot } from "../../../bindings/generation";
import { invokeHost } from "../../../shared/host/invoke";

export const accountApi = {
  account: () => invokeHost<AccountStatus>("get_account_status"),
  saveKey: (id: string | null, name: string, key: string | null) =>
    invokeHost<AccountStatus>("save_account_key", { id, name, key }),
  activate: (id: string) => invokeHost<AccountStatus>("activate_account", { id }),
  deleteKey: (id: string) => invokeHost<AccountStatus>("delete_account_key", { id }),
  accountSummary: () => invokeHost<AccountSnapshot>("get_account_summary"),
  refreshAccountSummary: () => invokeHost<AccountSnapshot>("refresh_account_summary"),
};
