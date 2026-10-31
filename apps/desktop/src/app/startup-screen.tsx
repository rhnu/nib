import { t, useTranslation, Trans } from "@/shared/i18n";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/shared/ui";
import appIcon from "@/assets/app-icon.svg";

export function StartupScreen({
  loading,
  error,
  retry,
  loadingLabel = t("app.openingData"),
}: {
  loading: boolean;
  error: string;
  retry: () => void;
  loadingLabel?: string;
}) {
  useTranslation();

  return (
    <main className="startup">
      <section className="startup-panel">
        <img
          className="app-icon brand-mark"
          src={appIcon}
          width={48}
          height={48}
          alt=""
          aria-hidden
        />
        <h1>{t("app.brandName")}</h1>
        {loading ? (
          <output className="startup-message">
            <LoaderCircle className="spin" size={17} />
            {loadingLabel}
          </output>
        ) : (
          <>
            <p className="startup-message">{error || t("app.desktopRequired")}</p>
            <Button onClick={retry}>{t("app.reconnect")}</Button>
            <details>
              <summary>{t("app.openWorkspaceHelp")}</summary>
              <p>
                <Trans
                  i18nKey="app.desktopCommandHelp"
                  components={{ desktop: <code />, web: <code /> }}
                />
              </p>
            </details>
          </>
        )}
      </section>
    </main>
  );
}
