import { useState } from "react";
import { KeyRound } from "lucide-react";
import { Button, Notice } from "../../shared/ui";
import { AccountDialog } from "./AccountDialog";
import { useGeneration } from "./generation-context";

export function AccountSettings() {
  const { account, accountLoading, accountError, refreshAccount } = useGeneration();
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
      {open && <AccountDialog onClose={() => setOpen(false)} />}
    </section>
  );
}
