import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t, useTranslation, useMessageState } from "@/shared/i18n";
import { Button, Field, Modal, Notice } from "@/shared/ui";

/** Credentials live only for this editing session and are discarded when the dialog closes. */
export function ConnectionDialog({
  savedUsername,
  busy,
  onClose,
  onSave,
}: {
  savedUsername: string | null;
  busy: boolean;
  onClose: () => void;
  onSave: (username: string, apiKey: string) => Promise<boolean>;
}) {
  useTranslation();
  const [username, setUsername] = useState(savedUsername ?? "");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useMessageState();
  const needsKey = !savedUsername || username.trim() !== savedUsername;
  return (
    <Modal open title={t("explore.editConnectionTitle")} onClose={onClose}>
      <form
        className="danbooru-connection-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || !username.trim() || (needsKey && !apiKey.trim())) return;
          setError(null);
          void onSave(username.trim(), apiKey.trim())
            .then((saved) => {
              if (saved) {
                setApiKey("");
                onClose();
              }
            })
            .catch(setError);
        }}
      >
        <Field label={t("explore.username")}>
          <input
            autoComplete="username"
            value={username}
            disabled={busy}
            required
            onChange={(event) => setUsername(event.target.value)}
          />
        </Field>
        <Field label={t("explore.apiKey")}>
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            disabled={busy}
            required={needsKey}
            placeholder={savedUsername ? t("explore.replaceKeyHint") : undefined}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </Field>
        <p className="muted">{t("explore.connectionHelp")}</p>
        {busy && <output aria-live="polite">{t("explore.connecting")}</output>}
        {error && <Notice>{error}</Notice>}
        <footer className="ui-actions">
          <Button
            className="danbooru-key-link"
            disabled={busy}
            onClick={() => void openUrl("https://danbooru.donmai.us/profile").catch(setError)}
          >
            {t("explore.getApiKey")}
          </Button>
          <Button disabled={busy} onClick={onClose}>
            {t("app.cancel")}
          </Button>
          <Button
            type="submit"
            className="primary"
            disabled={busy || !username.trim() || (needsKey && !apiKey.trim())}
          >
            {t("explore.verifySave")}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
