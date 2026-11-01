import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DanbooruConnectionStatus } from "@/bindings/settings";
import { queryClient } from "@/shared/query/client";
import { t, useTranslation, useMessageState } from "@/shared/i18n";
import { ActionsMenu, Button, HelpMarker, Modal, Notice, SettingsGroup } from "@/shared/ui";
import { danbooruApi, danbooruConnectionKey } from "./api";
import { ConnectionDialog } from "./connection-dialog";
import "./connection-settings.css";

/** Account details remain a summary; secret editing belongs to the transient dialog. */
export function ExploreConnectionSettings() {
  useTranslation();
  const status = useQuery({
    queryKey: danbooruConnectionKey,
    queryFn: danbooruApi.status,
    retry: false,
  });
  const [editing, setEditing] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useMessageState();

  const run = async (action: () => Promise<DanbooruConnectionStatus>) => {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      queryClient.setQueryData(danbooruConnectionKey, await action());
      return true;
    } finally {
      try {
        await status.refetch();
        await queryClient.invalidateQueries({ queryKey: ["explore"] });
      } finally {
        pending.current = false;
        setBusy(false);
      }
    }
  };

  return (
    <>
      <SettingsGroup
        title={
          <>
            {t("explore.danbooru")}
            <HelpMarker label={t("explore.danbooru")}>{t("explore.connectionHelp")}</HelpMarker>
          </>
        }
        actions={
          <>
            <Button disabled={busy || !status.data} onClick={() => setEditing(true)}>
              {status.data?.username ? t("explore.editConnection") : t("explore.connect")}
            </Button>
            <ActionsMenu
              label={t("explore.connectionActions")}
              disabled={busy || !status.data?.username}
              items={[
                {
                  label: t("explore.verify"),
                  action: () => void run(danbooruApi.verify).catch(setError),
                },
                { separator: true },
                {
                  label: t("explore.disconnect"),
                  danger: true,
                  action: () => setDisconnectOpen(true),
                },
              ]}
            />
          </>
        }
      >
        <output className="danbooru-connection-summary" aria-live="polite">
          {busy ? (
            t("explore.connecting")
          ) : status.isPending ? (
            t("explore.loading")
          ) : status.data ? (
            <>
              {t(`explore.connection_${status.data.state}`)} {status.data.username}
            </>
          ) : null}
        </output>
        {status.error && (
          <Notice
            actions={<Button onClick={() => void status.refetch()}>{t("explore.retry")}</Button>}
          >
            {t("explore.connectionFailed")}
          </Notice>
        )}
        {error && <Notice>{error}</Notice>}
      </SettingsGroup>
      {editing && (
        <ConnectionDialog
          savedUsername={status.data?.username ?? null}
          busy={busy}
          onClose={() => {
            if (!pending.current) setEditing(false);
          }}
          onSave={(username, apiKey) => run(() => danbooruApi.save(username, apiKey))}
        />
      )}
      {disconnectOpen && (
        <Modal open title={t("explore.disconnectTitle")} onClose={() => setDisconnectOpen(false)}>
          <p className="confirm-copy">{t("explore.disconnectHelp")}</p>
          <div className="ui-actions">
            <Button onClick={() => setDisconnectOpen(false)}>{t("app.cancel")}</Button>
            <Button
              className="danger"
              disabled={busy}
              onClick={() => {
                setDisconnectOpen(false);
                void run(danbooruApi.disconnect).catch(setError);
              }}
            >
              {t("explore.disconnect")}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
