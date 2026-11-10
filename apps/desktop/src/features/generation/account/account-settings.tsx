import { Button, Notice, SettingsGroup, SettingRow, Grid, Row } from "@/shared/ui";

import { t, useTranslation, useMessageState } from "@/shared/i18n";
import { useState } from "react";
import { Plus } from "lucide-react";
import { useAccount } from "./account-context";
import { accountApi } from "./api";

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
    <Grid
      gap={0}
      align="stretch"
      columns={1}
      as="section"
      className="generation-account-settings grid gap-space-6"
      aria-label={t("generation.novelaiAccount")}
    >
      <SettingsGroup
        title={t("generation.accountCredentials")}
        actions={
          <Button disabled={accountLoading || pending} onClick={() => setEditing(null)}>
            <Plus size={14} />
            {t("generation.addAccount")}
          </Button>
        }
      >
        {accountLoading ? (
          <p className="generation-muted text-muted">{t("generation.loadingAccounts")}</p>
        ) : !account?.credentials.length ? (
          <p className="generation-muted text-muted">{t("generation.addKeyHint")}</p>
        ) : (
          <Grid
            gap={0}
            align="stretch"
            columns={1}
            className="generation-account-list [&_.tag]:ml-space-3 grid gap-0"
          >
            {account.credentials.map((profile) => (
              <SettingRow
                key={profile.id}
                controlWidth="auto"
                label={
                  <>
                    {profile.name}
                    {account.activeId === profile.id && (
                      <span className="tag inline-flex items-center p-[1px_5px] leading-[19px] text-[10px] rounded-control bg-accent-soft text-accent whitespace-nowrap">
                        {t("generation.activeAccount")}
                      </span>
                    )}
                  </>
                }
              >
                <Row
                  gap={0}
                  className="generation-account-actions flex items-center flex-wrap gap-space-3"
                >
                  {account.activeId !== profile.id && (
                    <Button disabled={pending} onClick={() => void activate(profile.id)}>
                      {t("generation.useAccount")}
                    </Button>
                  )}
                  <Button disabled={pending} onClick={() => setEditing(profile.id)}>
                    {t("generation.edit")}
                  </Button>
                </Row>
              </SettingRow>
            ))}
          </Grid>
        )}
        {accountError && (
          <Notice
            actions={<Button onClick={() => void refreshAccount()}>{t("generation.retry")}</Button>}
          >
            {accountError}
          </Notice>
        )}
        {error && <Notice>{error}</Notice>}
      </SettingsGroup>
      <SettingsGroup title={t("generation.subscriptionBalance")}>
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
      </SettingsGroup>
      {editing !== undefined && (
        <AccountDialog
          onOpenTasks={onOpenTasks}
          id={editing}
          onClose={() => setEditing(undefined)}
        />
      )}
    </Grid>
  );
}
