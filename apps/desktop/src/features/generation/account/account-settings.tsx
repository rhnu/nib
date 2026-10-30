import { useState } from "react";
import { Plus } from "lucide-react";
import { useAccount } from "./account-context";
import { accountApi } from "./api";
import { Button, Notice } from "@/shared/ui";
import { AccountDialog } from "./account-dialog";
import { AccountSnapshot } from "./account-snapshot";
import { errorMessage } from "@/shared/host/error";

export function AccountSettings({ onOpenTasks }: { onOpenTasks?: () => void }) {
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
  const [error, setError] = useState("");
  async function activate(id: string) {
    setPending(true);
    setError("");
    try {
      accountChanged(await accountApi.activate(id));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="generation-account-settings" aria-label="NovelAI 账户">
      <div className="generation-account-row">
        <h3>账户凭据</h3>
        <Button disabled={accountLoading || pending} onClick={() => setEditing(null)}>
          <Plus size={14} />
          添加账户
        </Button>
      </div>
      {accountLoading ? (
        <p className="generation-muted">正在读取账户…</p>
      ) : !account?.credentials.length ? (
        <p className="generation-muted">添加 API Key 后可生成图片。</p>
      ) : (
        <div className="credential-list">
          {account.credentials.map((profile) => (
            <div className="generation-account-row" key={profile.id}>
              <span>
                {profile.name}
                {account.activeId === profile.id && <span className="tag">使用中</span>}
              </span>
              <div className="settings-actions">
                {account.activeId !== profile.id && (
                  <Button disabled={pending} onClick={() => void activate(profile.id)}>
                    使用此账户
                  </Button>
                )}
                <Button disabled={pending} onClick={() => setEditing(profile.id)}>
                  编辑
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {accountError && (
        <Notice actions={<Button onClick={() => void refreshAccount()}>重试</Button>}>
          {accountError}
        </Notice>
      )}
      {error && <Notice>{error}</Notice>}
      <h3>订阅与余额</h3>
      <AccountSnapshot />
      {accountSummaryError && (
        <Notice
          actions={
            <Button disabled={accountSummaryLoading} onClick={() => void refreshAccountSummary()}>
              重试查询
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
