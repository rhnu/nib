import { t, useTranslation, useMessageState } from "@/shared/i18n";
import { useState } from "react";
import { Plus } from "lucide-react";
import { useAccount } from "./account-context";
import { accountApi } from "./api";
import { Button, Notice } from "@/shared/ui";
import { AccountDialog } from "./account-dialog";
import { AccountSnapshot } from "./account-snapshot";

export function AccountSettings({ onOpenTasks }: { onOpenTasks?: () => void }) {
  useTranslation();

  const {
    account,
    accountLoading,
    accountError,
    refreshAccount,
    accountChanged,
    accountSummaryLoading,
    accountSummaryError,
    refreshAccountSummary,
  } = useAccount();
  const [editing, setEditing] = useState<string | null | undefined>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useMessageState();

  async function activate(id: string) {
    setPending(true);
    setError("");
    try {
      accountChanged(await accountApi.activate(id));
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="generation-account-settings" aria-label={t("generation.novelaiAccount")}>
      <div className="generation-account-row">
        <h3>{t("generation.accountCredentials")}</h3>
        <Button disabled={accountLoading || pending} onClick={() => setEditing(null)}>
          <Plus size={14} />
          {t("generation.addAccount")}
        </Button>
      </div>
      {accountLoading ? (
        <p className="generation-muted">{t("generation.loadingAccounts")}</p>
      ) : !account?.credentials.length ? (
        <p className="generation-muted">{t("generation.addKeyHint")}</p>
      ) : (
        <div className="generation-account-list">
          {account.credentials.map((profile) => (
            <div className="generation-account-row" key={profile.id}>
              <span>
                {profile.name}
                {account.activeId === profile.id && (
                  <span className="tag">{t("generation.activeAccount")}</span>
                )}
              </span>
              <div className="generation-account-actions">
                {account.activeId !== profile.id && (
                  <Button disabled={pending} onClick={() => void activate(profile.id)}>
                    {t("generation.useAccount")}
                  </Button>
                )}
                <Button disabled={pending} onClick={() => setEditing(profile.id)}>
                  {t("generation.edit")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {accountError && (
        <Notice
          actions={<Button onClick={() => void refreshAccount()}>{t("generation.retry")}</Button>}
        >
          {accountError}
        </Notice>
      )}
      {error && <Notice>{error}</Notice>}
      <h3>{t("generation.subscriptionBalance")}</h3>
      <AccountSnapshot />
      {accountSummaryError && (
        <Notice
          actions={
            <Button disabled={accountSummaryLoading} onClick={() => void refreshAccountSummary()}>
              {t("generation.retryQuery")}
            </Button>
          }
        >
          {accountSummaryError}
        </Notice>
      )}
      {editing !== undefined && (
        <AccountDialog
          onOpenTasks={onOpenTasks}
          id={editing}
          onClose={() => setEditing(undefined)}
        />
      )}
    </section>
  );
}
