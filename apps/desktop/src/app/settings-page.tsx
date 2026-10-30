import { t, useTranslation, useMessageState } from "@/shared/i18n";
import type { Language } from "@/bindings/settings";
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Moon, Sun } from "lucide-react";
import { AccountSettings } from "@/features/generation";
import { DownloadsSettings } from "@/features/downloads/downloads-settings";
import { Button, Field, HelpMarker, Notice, Toggle } from "@/shared/ui";
import type { ApplicationSettingsState } from "./use-application-settings";

function ExecutionSettings({ settings }: { settings: ApplicationSettingsState }) {
  useTranslation();

  const value = settings.preferences.value;
  if (!value) return null;
  const execution = value.execution;
  return (
    <section className="preference-section">
      <details className="execution-settings">
        <summary>{t("app.advancedExecution")}</summary>
        <div className="execution-settings-fields">
          <Field label={t("app.apiBaseUrl")}>
            <input
              type="url"
              value={execution.imageBaseUrl ?? ""}
              placeholder={t("app.defaultEndpointHint")}
              spellCheck={false}
              onChange={(event) =>
                settings.writer.edit({
                  ...value,
                  execution: { ...execution, imageBaseUrl: event.target.value.trim() || null },
                })
              }
            />
          </Field>
          <Field label={t("app.requestEncoding")}>
            <select
              value={execution.imageRequestEncoding}
              onChange={(event) =>
                settings.writer.edit({
                  ...value,
                  execution: {
                    ...execution,
                    imageRequestEncoding: event.target.value === "multipart" ? "multipart" : "json",
                  },
                })
              }
            >
              <option value="json">{t("app.json")}</option>
              <option value="multipart">{t("app.multipart")}</option>
            </select>
          </Field>
          <div className="preference-row">
            <span className="execution-setting-label">
              {t("app.serverImageCache")}
              <HelpMarker label={t("app.serverImageCacheHelpLabel")}>
                {t("app.serverImageCacheHelp")}
              </HelpMarker>
            </span>
            <Toggle
              label={t("app.serverImageCache")}
              checked={execution.serverImageCache}
              onChange={(serverImageCache) =>
                settings.writer.edit({ ...value, execution: { ...execution, serverImageCache } })
              }
            />
          </div>
        </div>
      </details>
    </section>
  );
}

function StorageSettings({
  settings,
  beforeMigrate,
}: {
  settings: ApplicationSettingsState;
  beforeMigrate?: () => Promise<void>;
}) {
  useTranslation();

  const { storage, setDataDirectory } = settings;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useMessageState();
  if (!storage) return null;

  const choose = async () => {
    setError("");
    try {
      const directory = await open({
        directory: true,
        multiple: false,
        title: t("app.chooseDataDirectory"),
      });
      if (!directory) return;
      setSaving(true);
      await setDataDirectory(directory, beforeMigrate);
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  };

  const showDirectory = async (path: string) => {
    try {
      await revealItemInDir(path);
    } catch (cause) {
      setError(cause);
    }
  };

  return (
    <section className="preference-section storage-settings">
      <div className="section-heading">
        <h2>{t("app.storageLocation")}</h2>
        {storage.development && <span className="tag">{t("app.developmentEnvironment")}</span>}
      </div>
      <div className="settings-path-row">
        <div className="settings-path">
          <span>{t("app.configDirectory")}</span>
          <code>{storage.configDirectory}</code>
        </div>
        <Button onClick={() => void showDirectory(storage.configDirectory)}>
          {t("app.openLocation")}
        </Button>
      </div>
      <div className="settings-path-row">
        <div className="settings-path">
          <span>{t("app.dataDirectory")}</span>
          <code>{storage.relocatedDataDirectory ?? storage.dataDirectory}</code>
        </div>
        <Button
          onClick={() =>
            void showDirectory(storage.relocatedDataDirectory ?? storage.dataDirectory)
          }
        >
          {t("app.openLocation")}
        </Button>
      </div>
      <div className="settings-actions">
        <Button disabled={saving || storage.restartRequired} onClick={() => void choose()}>
          {saving ? t("app.migrating") : t("app.changeLocation")}
        </Button>
        <HelpMarker label={t("app.changeStorageHelpLabel")}>
          {t("app.changeStorageHelp")}
        </HelpMarker>
      </div>
      {storage.restartRequired && <Notice>{t("app.locationChanged")}</Notice>}
      {error && <Notice>{error}</Notice>}
      {settings.storageError && (
        <Notice
          actions={
            <Button onClick={() => void settings.refreshStorage()}>{t("app.reload")}</Button>
          }
        >
          {settings.storageError}
        </Notice>
      )}
    </section>
  );
}

const sections = [
  {
    id: "account",
    get name() {
      return t("app.accountConnection");
    },
  },
  {
    id: "generation",
    get name() {
      return t("app.generationPreview");
    },
  },
  {
    id: "appearance",
    get name() {
      return t("app.appearance");
    },
  },
  {
    id: "storage",
    get name() {
      return t("app.storage");
    },
  },
  {
    id: "downloads",
    get name() {
      return t("downloads.title");
    },
  },
] as const;
export type SettingsSection = (typeof sections)[number]["id"];

export function SettingsPage({
  settings,
  showAccount = true,
  beforeMigrate,
  onOpenTasks,
  section,
  onSectionChange,
}: {
  settings: ApplicationSettingsState;
  showAccount?: boolean;
  beforeMigrate?: () => Promise<void>;
  onOpenTasks?: () => void;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}) {
  useTranslation();

  const { preferences, writer } = settings;
  const theme = preferences.value?.theme;
  return (
    <main className="settings-page" aria-label={t("app.settings")}>
      <header className="page-toolbar">
        <h1>{t("app.settings")}</h1>
      </header>
      <div className="settings-layout">
        <nav className="settings-navigation" aria-label={t("app.settingsCategories")}>
          {sections.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={section === item.id ? "page" : undefined}
              onClick={() => onSectionChange(item.id)}
            >
              {item.name}
            </button>
          ))}
        </nav>
        <div className="settings-page-content">
          <div hidden={section !== "account"}>
            {showAccount && (
              <section className="preference-section">
                <h2>{t("app.accountConnection")}</h2>
                <AccountSettings onOpenTasks={onOpenTasks} />
              </section>
            )}
            <ExecutionSettings settings={settings} />
          </div>
          <section className="preference-section" hidden={section !== "generation"}>
            <h2>{t("app.generationPreview")}</h2>
            {preferences.value && (
              <Field label={t("app.recentImageCount")}>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={preferences.value.recentImageLimit}
                  onChange={(event) => {
                    const limit = Number(event.target.value);
                    if (Number.isInteger(limit) && limit >= 1 && limit <= 200 && preferences.value)
                      writer.edit({ ...preferences.value, recentImageLimit: limit });
                  }}
                />
              </Field>
            )}
          </section>
          <section
            className="preference-section appearance-settings"
            hidden={section !== "appearance"}
          >
            <h2>{t("app.appearance")}</h2>
            <Field label={t("language.label")}>
              <select
                value={preferences.value?.language ?? "system"}
                disabled={!preferences.value}
                onChange={(event) => {
                  if (preferences.value)
                    writer.edit({ ...preferences.value, language: event.target.value as Language });
                }}
              >
                <option value="system">{t("language.system")}</option>
                <option value="en">{t("language.english")}</option>
                <option value="zh-CN">{t("language.simplifiedChinese")}</option>
              </select>
            </Field>
            <div className="preference-row">
              <span>{t("app.theme")}</span>
              <Button
                disabled={!theme}
                onClick={() => {
                  if (preferences.value)
                    writer.edit({
                      ...preferences.value,
                      theme: theme === "dark" ? "light" : "dark",
                    });
                }}
              >
                {theme === "dark" ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
                {theme === "dark" ? t("app.switchToLight") : t("app.switchToDark")}
              </Button>
            </div>
          </section>
          <div hidden={section !== "storage"}>
            <StorageSettings settings={settings} beforeMigrate={beforeMigrate} />
          </div>
          <div hidden={section !== "downloads"}>
            <DownloadsSettings />
          </div>
        </div>
      </div>
    </main>
  );
}
