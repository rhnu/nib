import { useAccount } from "./account-context";
import { accountApi } from "./api";
import { useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { Button, Field, Modal, Notice } from "@/shared/ui";
import { errorMessage } from "@/shared/host/error";

export function AccountDialog({
  id = null,
  onClose,
  onOpenTasks,
}: {
  id?: string | null;
  onClose: () => void;
  onOpenTasks?: () => void;
}) {
  const { account, accountChanged } = useAccount();
  const [name, setName] = useState(
    () => account?.credentials.find((profile) => profile.id === id)?.name ?? "",
  );
  const [key, setKey] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const [blockedByTasks, setBlockedByTasks] = useState(false);

  async function save() {
    if (!name.trim() || (!id && !key.trim()) || pending) return;
    setPending(true);
    setError("");
    try {
      accountChanged(await accountApi.saveKey(id, name.trim(), key.trim() || null));
      setKey("");
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!id || pending) return;
    setPending(true);
    setError("");
    setBlockedByTasks(false);
    try {
      accountChanged(await accountApi.deleteKey(id));
      setKey("");
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
      setBlockedByTasks(
        typeof cause === "object" && cause !== null && "code" in cause && cause.code === "conflict",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!pending) {
          setKey("");
          onClose();
        }
      }}
      title={id ? "编辑账户" : "添加账户"}
    >
      <form
        className="generation-dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label="账户名称">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={pending}
            required
          />
        </Field>
        <Field label={id ? "新的 API Key（留空保留）" : "NovelAI API Key"}>
          <input
            type="password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
            required={!id}
          />
        </Field>
        <p className="generation-muted">
          API Key 仅保存在 Windows 凭据管理器。更换后，已有任务继续使用提交时的凭据。
        </p>
        {error && (
          <Notice
            actions={
              blockedByTasks && onOpenTasks ? (
                <Button
                  onClick={() => {
                    setKey("");
                    onClose();
                    onOpenTasks();
                  }}
                >
                  查看任务
                </Button>
              ) : undefined
            }
          >
            {error}
          </Notice>
        )}
        {confirmDelete && (
          <Notice
            actions={
              <>
                <Button disabled={pending} onClick={() => setConfirmDelete(false)}>
                  取消删除
                </Button>
                <Button className="danger" disabled={pending} onClick={() => void remove()}>
                  确认删除
                </Button>
              </>
            }
          >
            删除“{name}”及其保存的凭据？有未完成任务时须先处理任务。
          </Notice>
        )}
        <footer className="generation-dialog-actions">
          {id && (
            <Button className="danger" disabled={pending} onClick={() => setConfirmDelete(true)}>
              <Trash2 size={14} />
              删除账户
            </Button>
          )}
          <span className="generation-spacer" />
          <Button
            disabled={pending}
            onClick={() => {
              setKey("");
              onClose();
            }}
          >
            取消
          </Button>
          <Button
            type="submit"
            className="primary"
            disabled={pending || !name.trim() || (!id && !key.trim())}
          >
            <KeyRound size={14} />
            {pending ? "正在保存…" : "保存"}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
