import { t, useTranslation, useMessageState } from "@/shared/i18n";
import { useEffect, useState } from "react";
import { AccountProvider } from "@/features/generation/account/account-provider";
import { WorkspaceShell } from "./workspace-shell";
import { GenerationProvider } from "@/features/generation";
import { StartupScreen } from "./startup-screen";
import { TitleBar } from "./title-bar";
import { useTheme } from "./use-theme";
import { useLanguage } from "./use-language";
import { useWorkspaceStartup } from "./use-workspace-startup";
import { SettingsPage, type SettingsSection } from "./settings-page";
import { useApplicationSettings } from "./use-application-settings";
import { useCloseGuard } from "@/shared/host/use-close-guard";
import { Button, Notice } from "@/shared/ui";
import { errorMessage } from "@/shared/host/error";
import { NavigationIcon } from "./navigation-icon";

/** Composition root: application startup and theme, then domain-owned surfaces. */
export default function App() {
  useTranslation();

  const settings = useApplicationSettings();
  useTheme(settings.preferences.value?.theme);
  useLanguage(settings.preferences.value?.language);
  const { workspace, loading, error, retry } = useWorkspaceStartup(settings.ready);
  const [startupPage, setStartupPage] = useState<"create" | "settings">("create");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("account");
  const [closeError, setCloseError] = useMessageState();
  useCloseGuard({
    writer: settings.closeWriter,
    resourceDirty: false,
    onResourceBlocked: () => {},
    onError: setCloseError,
    enabled: !workspace,
  });
  const refreshStorage = settings.refreshStorage;
  useEffect(() => {
    if (workspace) void refreshStorage();
  }, [workspace, refreshStorage]);
  const readOnly = settings.migrationPending || Boolean(settings.storage?.restartRequired);
  const settingsNotice = (
    <>
      {settings.migrationPending && <Notice>{t("app.migrationInProgress")}</Notice>}
      {settings.storage?.restartRequired && <Notice>{t("app.migrationComplete")}</Notice>}
      {Boolean(settings.preferences.error) && (
        <Notice
          actions={
            <Button onClick={() => void settings.writer.flush().catch(() => {})}>
              {t("app.retrySync")}
            </Button>
          }
        >
          {t("app.preferencesUnsaved")}
          {errorMessage(settings.preferences.error)}
        </Notice>
      )}
      {closeError && (
        <Notice
          actions={<Button onClick={() => setCloseError("")}>{t("app.dismissNotice")}</Button>}
        >
          {closeError}
        </Notice>
      )}
    </>
  );
  return (
    <AccountProvider executionVersion={settings.executionVersion}>
      <div className="application">
        {!workspace ? (
          <>
            <TitleBar
              navigation={
                settings.ready && (
                  <nav className="desktop-navigation" aria-label={t("app.mainNavigation")}>
                    <Button
                      aria-current={startupPage === "create" ? "page" : undefined}
                      onClick={() => setStartupPage("create")}
                    >
                      <NavigationIcon page="create" />
                      {t("app.create")}
                    </Button>
                    <Button
                      aria-current={startupPage === "settings" ? "page" : undefined}
                      onClick={() => setStartupPage("settings")}
                    >
                      <NavigationIcon page="settings" />
                      {t("app.settings")}
                    </Button>
                  </nav>
                )
              }
            />
            {settingsNotice}
            {settings.ready ? (
              startupPage === "settings" ? (
                <div inert={readOnly} style={{ display: "contents" }}>
                  <SettingsPage
                    settings={settings}
                    section={settingsSection}
                    onSectionChange={setSettingsSection}
                  />
                </div>
              ) : (
                <>
                  {error && (
                    <Notice
                      actions={
                        <Button onClick={() => setStartupPage("settings")}>
                          {t("app.changeStorage")}
                        </Button>
                      }
                    >
                      {t("app.dataUnavailable")}
                    </Notice>
                  )}
                  <StartupScreen loading={loading} error={error} retry={retry} />
                </>
              )
            ) : (
              <StartupScreen
                loading={settings.loading}
                error={settings.error}
                retry={settings.retry}
                loadingLabel={t("app.syncingPreferences")}
              />
            )}
          </>
        ) : (
          <GenerationProvider
            beforeSubmit={settings.prepareSubmission}
            submissionBlocked={settings.submissionBlocked}
          >
            <WorkspaceShell
              workspace={workspace.snapshot}
              initialResources={workspace.resources}
              startupSettings={startupPage === "settings"}
              recentImageLimit={settings.preferences.value?.recentImageLimit ?? 20}
              settingsWriter={settings.closeWriter}
              onSelectDownloadSettings={() => setSettingsSection("downloads")}
              renderHeader={(navigation) => (
                <>
                  <TitleBar navigation={navigation} />
                  {settingsNotice}
                </>
              )}
              readOnly={readOnly}
              renderSettings={({ beforeMigrate, onOpenTasks }) => (
                <SettingsPage
                  settings={settings}
                  section={settingsSection}
                  onSectionChange={setSettingsSection}
                  beforeMigrate={beforeMigrate}
                  onOpenTasks={onOpenTasks}
                />
              )}
            />
          </GenerationProvider>
        )}
      </div>
    </AccountProvider>
  );
}
