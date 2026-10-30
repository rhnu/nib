import { useState } from "react";
import { Button, Field, Notice, Toggle } from "@/shared/ui";
import { formatNumber, t, useMessageState, useTranslation } from "@/shared/i18n";
import { errorMessage } from "@/shared/host/error";
import { lexiconApi } from "./api";
import { useLexiconStatus } from "./use-lexicon-status";
import "./styles.css";

export function LexiconSettings() {
  useTranslation();
  const status = useLexiconStatus();
  const [manifestUrl, setManifestUrl] = useState(
    "https://github.com/RhNu/nib/releases/download/lexicon-current/lexicon-manifest.json",
  );
  const [semantic, setSemantic] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useMessageState();
  const progress = status.data?.install;
  const active = progress && ["downloading", "verifying", "activating"].includes(progress.state);
  const states = {
    downloading: t("lexicon.downloading"),
    verifying: t("lexicon.verifying"),
    activating: t("lexicon.activating"),
    complete: t("lexicon.complete"),
    cancelled: t("lexicon.cancelled"),
    failed: t("lexicon.failed"),
  };

  const run = async (operation: () => Promise<void>) => {
    setPending(true);
    setError("");
    try {
      await operation();
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="preference-section lexicon-settings">
      <h2>{t("lexicon.installTitle")}</h2>
      {status.isPending ? (
        <output>{t("lexicon.loading")}</output>
      ) : status.error ? (
        <Notice
          actions={<Button onClick={() => void status.refetch()}>{t("lexicon.retry")}</Button>}
        >
          {errorMessage(status.error)}
        </Notice>
      ) : (
        <p>
          {status.data?.generation
            ? t("lexicon.installed", { count: status.data.termCount })
            : t("lexicon.notInstalled")}
        </p>
      )}
      {status.data?.resourceDirectory && (
        <div className="settings-path">
          <span>{t("lexicon.resourceDirectory")}</span>
          <code>{status.data.resourceDirectory}</code>
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => lexiconApi.install(manifestUrl.trim(), semantic));
        }}
      >
        <Field label={t("lexicon.manifestUrl")}>
          <input
            type="url"
            required
            value={manifestUrl}
            disabled={pending || Boolean(active)}
            onChange={(event) => setManifestUrl(event.target.value)}
            spellCheck={false}
          />
        </Field>
        <div className="preference-row">
          <span>{t("lexicon.semanticDownload")}</span>
          <Toggle
            checked={semantic}
            label={t("lexicon.semanticDownload")}
            disabled={pending || Boolean(active)}
            onChange={setSemantic}
          />
        </div>
        <div className="settings-actions">
          <Button type="submit" disabled={!manifestUrl.trim() || pending || Boolean(active)}>
            {t("lexicon.download")}
          </Button>
          {active && (
            <Button disabled={pending} onClick={() => void run(lexiconApi.cancel)}>
              {t("lexicon.cancel")}
            </Button>
          )}
        </div>
      </form>
      {progress && (
        <output className="lexicon-install-progress">
          <span>{states[progress.state]}</span>
          {active && (
            <>
              <progress
                max={progress.totalBytes || undefined}
                value={progress.totalBytes ? progress.completedBytes : undefined}
                aria-label={states[progress.state]}
              />
              <span>
                {t("lexicon.progress", {
                  completed: formatNumber(progress.completedBytes),
                  total: formatNumber(progress.totalBytes),
                })}
              </span>
            </>
          )}
          {progress.message && <span>{progress.message}</span>}
        </output>
      )}
      {error && <Notice>{error}</Notice>}
    </section>
  );
}
