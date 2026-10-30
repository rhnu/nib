import { t, useTranslation, useMessageState } from "@/shared/i18n";
import { useAccount } from "./account-context";
import { accountApi } from "./api";
import { useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { Button, Field, Modal, Notice } from "@/shared/ui";

export function AccountDialog({
  id = null,
  onClose,
  onOpenTasks,
}: {
  id?: string | null;
  onClose: () => void;
  onOpenTasks?: () => void;
}) {
  useTranslation();

  const { account, accountChanged } = useAccount();
  const [name, setName] = useState(
    () => account?.credentials.find((profile) => profile.id === id)?.name ?? "",
  );
  const [key, setKey] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useMessageState();
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
      setError(cause);
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
      setError(cause);
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
      title={id ? t("generation.editAccount") : t("generation.addAccount")}
    >
      <form
        className="generation-dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label={t("generation.accountName")}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={pending}
            required
          />
        </Field>
        <Field label={id ? t("generation.newApiKey") : t("generation.apiKeyLabel")}>
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
        <p className="generation-muted">{t("generation.credentialStorageHelp")}</p>
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
                  {t("generation.viewTasks")}
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
                  {t("generation.cancelDeletion")}
                </Button>
                <Button className="danger" disabled={pending} onClick={() => void remove()}>
                  {t("generation.confirmDeletion")}
                </Button>
              </>
            }
          >
            {t("generation.deleteAccountConfirmation", { name })}
          </Notice>
        )}
        <footer className="generation-dialog-actions">
          {id && (
            <Button className="danger" disabled={pending} onClick={() => setConfirmDelete(true)}>
              <Trash2 size={14} />
              {t("generation.deleteAccount")}
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
            {t("generation.cancel")}
          </Button>
          <Button
            type="submit"
            className="primary"
            disabled={pending || !name.trim() || (!id && !key.trim())}
          >
            <KeyRound size={14} />
            {pending ? t("generation.saving") : t("generation.save")}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
