import { Button, Field, Modal, Notice, Input, Col, Toolbar } from "@/shared/ui";

import { t, useTranslation, useMessageState } from "@/shared/i18n";
import { useAccount } from "./account-context";
import { accountApi } from "./api";
import { useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";

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
      <Col
        gap={0}
        align="stretch"
        as="form"
        className="generation-dialog-body flex flex-col gap-space-4 p-0 overflow-auto [&_button]:shrink-0 [&_p]:m-0"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field required label={t("generation.accountName")}>
          <Input
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={pending}
          />
        </Field>
        <Field required={!id} label={id ? t("generation.newApiKey") : t("generation.apiKeyLabel")}>
          <Input
            type="password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
          />
        </Field>
        <p className="generation-muted text-muted">{t("generation.credentialStorageHelp")}</p>
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
                <Button
                  className="danger text-danger"
                  disabled={pending}
                  onClick={() => void remove()}
                >
                  {t("generation.confirmDeletion")}
                </Button>
              </>
            }
          >
            {t("generation.deleteAccountConfirmation", { name })}
          </Notice>
        )}
        <Toolbar
          gap={2}
          as="footer"
          className="ui-actions flex items-center justify-end flex-wrap gap-space-3"
        >
          {id && (
            <Button
              className="danger text-danger"
              disabled={pending}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={14} />
              {t("generation.deleteAccount")}
            </Button>
          )}
          <span className="generation-spacer flex-1" />
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
            variant="primary"
            type="submit"
            className=""
            disabled={pending || !name.trim() || (!id && !key.trim())}
          >
            <KeyRound size={14} />
            {pending ? t("generation.saving") : t("generation.save")}
          </Button>
        </Toolbar>
      </Col>
    </Modal>
  );
}
