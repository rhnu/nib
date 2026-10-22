import { useState } from "react";
import { KeyRound, RotateCw } from "lucide-react";
import { Button, Notice } from "../../shared/ui";
import { AccountDialog } from "./AccountDialog";
import { useGeneration } from "./generation-context";
import { AccountSnapshot } from "./AccountSnapshot";

export function AccountSettings() {
  const {
    account,
    accountLoading,
    accountError,
    refreshAccount,
    accountSummaryLoading,
    accountSummaryError,
    refreshAccountSummary,
  } = useGeneration();
  const [open, setOpen] = useState(false);
  return (
    <section className="generation-account-settings" aria-label="NovelAI 账户">
      <div className="generation-account-row">
        <div>
          <h3>NovelAI 账户</h3>
          <p className="generation-muted">
            {accountLoading
              ? "正在读取凭据状态…"
              : account
                ? account.configured
                  ? "已配置 API Key"
                  : "尚未配置 API Key"
                : "凭据状态未读取"}
          </p>
        </div>
        <Button disabled={accountLoading} onClick={() => setOpen(true)}>
          <KeyRound size={14} />
          {account?.configured ? "管理凭据" : "配置账户"}
        </Button>
      </div>
      {accountError && (
        <Notice actions={<Button onClick={() => void refreshAccount()}>重试查询</Button>}>
          {accountError}
        </Notice>
      )}
      <div className="generation-account-row">
        <h3>订阅与余额</h3>
        <Button
          disabled={!account?.configured || accountSummaryLoading || accountLoading}
          onClick={() => void refreshAccountSummary()}
        >
          <RotateCw size={14} />
          {accountSummaryLoading ? "正在刷新…" : "刷新账户快照"}
        </Button>
      </div>
      <AccountSnapshot />
      {accountSummaryError && <Notice>账户快照刷新失败：{accountSummaryError}</Notice>}
      {open && <AccountDialog onClose={() => setOpen(false)} />}
    </section>
  );
}
