import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DanbooruConnectionStatus } from "@/bindings/settings";
import { openUrl } from "@tauri-apps/plugin-opener";
import { queryClient } from "@/shared/query/client";
import { t, useTranslation, useMessageState } from "@/shared/i18n";
import { ActionsMenu, Button, Modal, Notice, SettingRow, SettingsGroup } from "@/shared/ui";
import { danbooruApi, danbooruConnectionKey } from "./api";

/** Secret input is transient and cleared after saving or disconnecting. */
export function ExploreConnectionSettings() {
  useTranslation();
  const status = useQuery({
    queryKey: danbooruConnectionKey,
    queryFn: danbooruApi.status,
    retry: false,
  });
  const [username, setUsername] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useMessageState();

  const run = async (action: () => Promise<DanbooruConnectionStatus>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const value = await action();
      queryClient.setQueryData(danbooruConnectionKey, value);
      setApiKey("");
      setUsername("");
    } catch (cause) {
      setError(cause);
    } finally {
      await status.refetch();
      await queryClient.invalidateQueries({ queryKey: ["explore"] });
      setBusy(false);
    }
  };

  return (
    <>
      <SettingsGroup title={t("explore.danbooru")} description={t("explore.connectionHelp")}>
        {status.isPending && <output>{t("explore.loading")}</output>}
        {status.error && (
          <Notice
            actions={<Button onClick={() => void status.refetch()}>{t("explore.retry")}</Button>}
          >
            {t("explore.connectionFailed")}
          </Notice>
        )}
        {status.data && (
          <p className="muted">
            {t(`explore.connection_${status.data.state}`)} {status.data.username}
          </p>
        )}
        <SettingRow label={t("explore.username")} htmlFor="danbooru-username" controlWidth="wide">
          <input
            id="danbooru-username"
            autoComplete="username"
            value={username}
            disabled={busy}
            onChange={(event) => setUsername(event.target.value)}
            placeholder={status.data?.username ?? ""}
          />
        </SettingRow>
        <SettingRow label={t("explore.apiKey")} htmlFor="danbooru-key" controlWidth="wide">
          <input
            id="danbooru-key"
            type="password"
            autoComplete="off"
            placeholder={status.data?.username ? t("explore.replaceKeyHint") : undefined}
            value={apiKey}
            disabled={busy}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </SettingRow>
        <div className="settings-actions">
          <Button
            disabled={
              busy ||
              !(username.trim() || status.data?.username) ||
              (!apiKey.trim() &&
                Boolean(username.trim() && username.trim() !== status.data?.username)) ||
              (!apiKey.trim() && !status.data?.username)
            }
            onClick={() =>
              void run(() =>
                danbooruApi.save(username.trim() || status.data!.username!, apiKey.trim()),
              )
            }
          >
            {t("explore.verifySave")}
          </Button>
          <Button
            disabled={busy || !status.data?.username}
            onClick={() => void run(danbooruApi.verify)}
          >
            {t("explore.verify")}
          </Button>
          <Button
            disabled={busy}
            onClick={() => void openUrl("https://danbooru.donmai.us/profile").catch(setError)}
          >
            {t("explore.getApiKey")}
          </Button>
          <ActionsMenu
            label={t("explore.connectionActions")}
            items={[
              {
                label: t("explore.disconnect"),
                danger: true,
                disabled: busy || !status.data?.username,
                action: () => setDisconnectOpen(true),
              },
            ]}
          />
        </div>
        {busy && <output>{t("explore.connecting")}</output>}
        {error && <Notice>{error}</Notice>}
      </SettingsGroup>
      {disconnectOpen && (
        <Modal open title={t("explore.disconnectTitle")} onClose={() => setDisconnectOpen(false)}>
          <div className="settings-actions">
            <p>{t("explore.disconnectHelp")}</p>
            <Button onClick={() => setDisconnectOpen(false)}>{t("app.cancel")}</Button>
            <Button
              className="danger"
              disabled={busy}
              onClick={() => {
                setDisconnectOpen(false);
                void run(danbooruApi.disconnect);
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
