import { Button, Field, Modal, Notice, Grid, Input, ButtonGroup } from "@/shared/ui";

import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t, useTranslation, useMessageState } from "@/shared/i18n";

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
      <Grid
        align="stretch"
        gap={4}
        columns={1}
        as="form"
        className="danbooru-connection-form [&_>_p]:m-0"
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
        <Field required label={t("explore.username")}>
          <Input
            autoComplete="username"
            value={username}
            disabled={busy}

            onChange={(event) => setUsername(event.target.value)}
          />
        </Field>
        <Field required={needsKey} label={t("explore.apiKey")}>
          <Input
            type="password"
            autoComplete="off"
            value={apiKey}
            disabled={busy}

            placeholder={savedUsername ? t("explore.replaceKeyHint") : undefined}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </Field>
        <p className="muted text-muted">{t("explore.connectionHelp")}</p>
        {busy && <output aria-live="polite">{t("explore.connecting")}</output>}
        {error && <Notice>{error}</Notice>}
        <ButtonGroup
          gap={0}
          justify="end"
          as="footer"
          className="ui-actions flex items-center justify-end flex-wrap gap-space-3"
        >
          <Button
            className="danbooru-key-link mr-auto"
            disabled={busy}
            onClick={() => void openUrl("https://danbooru.donmai.us/profile").catch(setError)}
          >
            {t("explore.getApiKey")}
          </Button>
          <Button disabled={busy} onClick={onClose}>
            {t("app.cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={busy || !username.trim() || (needsKey && !apiKey.trim())}
          >
            {t("explore.verifySave")}
          </Button>
        </ButtonGroup>
      </Grid>
    </Modal>
  );
}
