import { t, useTranslation, useMessageState } from "@/shared/i18n";
import type { Language } from "@/bindings/settings";
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Moon, Sun } from "lucide-react";
import { ExploreConnectionSettings } from "@/features/explore/connection-settings";
import { AccountSettings } from "@/features/generation";
import { DownloadsSettings } from "@/features/downloads/downloads-settings";
import { Button, HelpMarker, Notice, Toggle, Select, SettingRow, SettingsGroup } from "@/shared/ui";
import type { ApplicationSettingsState } from "./use-application-settings";
import type { ApplicationUpdates } from "./use-application-updates";
import { ApplicationUpdateSettings } from "./application-updates";

function ExecutionSettings({ settings }: { settings: ApplicationSettingsState }) {
  useTranslation();

  const value = settings.preferences.value;
  if (!value) return null;
  const execution = value.execution;
  return (
    <SettingsGroup>
      <details className="execution-settings">
        <summary>{t("app.advancedExecution")}</summary>
        <div className="execution-settings-fields">
          <SettingRow label={t("app.apiBaseUrl")} htmlFor="settings-endpoint" controlWidth="wide">
            <input
              id="settings-endpoint"
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
          </SettingRow>
          <SettingRow label={t("app.requestEncoding")} htmlFor="settings-encoding">
            <Select
              id="settings-encoding"
              value={execution.imageRequestEncoding}
              options={[
                { value: "json", label: t("app.json") },
                { value: "multipart", label: t("app.multipart") },
              ]}
              onValueChange={(encoding) =>
                settings.writer.edit({
                  ...value,
                  execution: {
                    ...execution,
                    imageRequestEncoding: encoding === "multipart" ? "multipart" : "json",
                  },
                })
              }
            />
          </SettingRow>
          <SettingRow
            label={t("app.serverImageCache")}
            controlWidth="auto"
            help={
              <HelpMarker label={t("app.serverImageCacheHelpLabel")}>
                {t("app.serverImageCacheHelp")}
              </HelpMarker>
            }
          >
            <Toggle
              label={t("app.serverImageCache")}
              checked={execution.serverImageCache}
              onChange={(serverImageCache) =>
                settings.writer.edit({ ...value, execution: { ...execution, serverImageCache } })
              }
            />
          </SettingRow>
        </div>
      </details>
    </SettingsGroup>
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
    <SettingsGroup
      title={t("app.storageLocation")}
      headingLevel={2}
      actions={
        storage.development && <span className="tag">{t("app.developmentEnvironment")}</span>
      }
    >
      <SettingRow
        label={t("app.configDirectory")}
        description={<code>{storage.configDirectory}</code>}
        controlWidth="auto"
      >
        <Button onClick={() => void showDirectory(storage.configDirectory)}>
          {t("app.openLocation")}
        </Button>
      </SettingRow>
      <SettingRow
        label={t("app.dataDirectory")}
        description={<code>{storage.relocatedDataDirectory ?? storage.dataDirectory}</code>}
        controlWidth="auto"
      >
        <Button
          onClick={() =>
            void showDirectory(storage.relocatedDataDirectory ?? storage.dataDirectory)
          }
        >
          {t("app.openLocation")}
        </Button>
      </SettingRow>
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
    </SettingsGroup>
  );
}

const sections = [
  {
    id: "updates",
    get name() {
      return t("updates.title");
    },
  },
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
  updates,
  settings,
  showAccount = true,
  beforeMigrate,
  onOpenTasks,
  section,
  onSectionChange,
}: {
  updates: ApplicationUpdates;
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
          <section className="settings-category" hidden={section !== "updates"}>
            <h2 className="settings-category-title">{t("updates.title")}</h2>
            <ApplicationUpdateSettings updates={updates} />
          </section>
          <div className="settings-category" hidden={section !== "account"}>
            {showAccount && (
              <div>
                <h2 className="settings-category-title">{t("app.accountConnection")}</h2>
                <AccountSettings onOpenTasks={onOpenTasks} />
              </div>
            )}
            <ExploreConnectionSettings />
            <ExecutionSettings settings={settings} />
          </div>
          <section className="settings-category" hidden={section !== "generation"}>
            <h2 className="settings-category-title">{t("app.generationPreview")}</h2>
            {preferences.value && (
              <>
                <SettingsGroup>
                  <SettingRow
                    label={t("app.recentImageCount")}
                    htmlFor="settings-recent-images"
                    controlWidth="short"
                  >
                    <input
                      id="settings-recent-images"
                      type="number"
                      min={1}
                      max={200}
                      value={preferences.value.recentImageLimit}
                      onChange={(event) => {
                        const limit = Number(event.target.value);
                        if (
                          Number.isInteger(limit) &&
                          limit >= 1 &&
                          limit <= 200 &&
                          preferences.value
                        )
                          writer.edit({ ...preferences.value, recentImageLimit: limit });
                      }}
                    />
                  </SettingRow>
                </SettingsGroup>
                <SettingsGroup
                  title={t("safety.title")}
                  description={t("safety.help")}
                  actions={
                    <Button onClick={() => onSectionChange("downloads")}>
                      {t("safety.downloads")}
                    </Button>
                  }
                >
                  {(["autoScan", "useWdReview"] as const).map((key) => (
                    <SettingRow label={t(`safety.${key}`)} key={key} controlWidth="auto">
                      <Toggle
                        label={t(`safety.${key}`)}
                        checked={preferences.value!.safety[key]}
                        onChange={(checked) => {
                          if (preferences.value)
                            writer.edit({
                              ...preferences.value,
                              safety: { ...preferences.value.safety, [key]: checked },
                            });
                        }}
                      />
                    </SettingRow>
                  ))}
                </SettingsGroup>
              </>
            )}
          </section>
          <section className="settings-category" hidden={section !== "appearance"}>
            <h2 className="settings-category-title">{t("app.appearance")}</h2>
            <SettingsGroup>
              <SettingRow label={t("language.label")} htmlFor="settings-language">
                <Select
                  id="settings-language"
                  value={preferences.value?.language ?? "system"}
                  disabled={!preferences.value}
                  options={[
                    { value: "system", label: t("language.system") },
                    { value: "en", label: t("language.english") },
                    { value: "zh-CN", label: t("language.simplifiedChinese") },
                  ]}
                  onValueChange={(language) => {
                    if (preferences.value)
                      writer.edit({ ...preferences.value, language: language as Language });
                  }}
                />
              </SettingRow>
              <SettingRow label={t("app.theme")} controlWidth="auto">
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
                  {theme === "dark" ? (
                    <Sun size={15} aria-hidden />
                  ) : (
                    <Moon size={15} aria-hidden />
                  )}
                  {theme === "dark" ? t("app.switchToLight") : t("app.switchToDark")}
                </Button>
              </SettingRow>
            </SettingsGroup>
            {preferences.value && (
              <SettingsGroup title={t("safety.title")}>
                {(["blurNsfw", "blurDetails"] as const).map((key) => (
                  <SettingRow label={t(`safety.${key}`)} key={key} controlWidth="auto">
                    <Toggle
                      label={t(`safety.${key}`)}
                      checked={preferences.value!.safety[key]}
                      onChange={(checked) => {
                        if (preferences.value)
                          writer.edit({
                            ...preferences.value,
                            safety: { ...preferences.value.safety, [key]: checked },
                          });
                      }}
                    />
                  </SettingRow>
                ))}
              </SettingsGroup>
            )}
          </section>
          <div hidden={section !== "storage"}>
            <StorageSettings settings={settings} beforeMigrate={beforeMigrate} />
          </div>
          <div hidden={section !== "downloads"}>
            {preferences.value && (
              <SettingsGroup>
                <SettingRow
                  label={t("lexicon.enableSemanticSearch")}
                  description={t("lexicon.semanticSearchHelp")}
                  controlWidth="auto"
                >
                  <Toggle
                    label={t("lexicon.enableSemanticSearch")}
                    checked={preferences.value.semanticSearchEnabled}
                    onChange={(semanticSearchEnabled) => {
                      if (preferences.value)
                        writer.edit({ ...preferences.value, semanticSearchEnabled });
                    }}
                  />
                </SettingRow>
              </SettingsGroup>
            )}
            <DownloadsSettings />
          </div>
        </div>
      </div>
    </main>
  );
}
