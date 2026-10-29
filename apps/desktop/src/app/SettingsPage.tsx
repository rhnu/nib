import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Moon, Sun } from "lucide-react";
import { AccountSettings } from "../features/generation";
import { Button, Field, HelpMarker, Notice, Toggle } from "../shared/ui";
import { errorMessage } from "../shared/host/error";
import type { ApplicationSettingsState } from "./useApplicationSettings";

function ExecutionSettings({ settings }: { settings: ApplicationSettingsState }) {
  const value = settings.preferences.value;
  if (!value) return null;
  const execution = value.execution;
  return (
    <section className="preference-section">
      <details className="execution-settings">
        <summary>高级执行设置</summary>
        <div className="execution-settings-fields">
          <Field label="API 端点基址">
            <input
              type="url"
              value={execution.imageBaseUrl ?? ""}
              placeholder="留空使用默认端点"
              spellCheck={false}
              onChange={(event) =>
                settings.writer.edit({
                  ...value,
                  execution: { ...execution, imageBaseUrl: event.target.value.trim() || null },
                })
              }
            />
          </Field>
          <Field label="图像请求编码">
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
              <option value="json">JSON</option>
              <option value="multipart">Multipart</option>
            </select>
          </Field>
          <div className="preference-row">
            <span className="execution-setting-label">
              服务端图像缓存
              <HelpMarker label="服务端图像缓存说明">
                复用上传到 NovelAI 的图像。更改后对新提交的任务生效。
              </HelpMarker>
            </span>
            <Toggle
              label="服务端图像缓存"
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
  const { storage, setDataDirectory } = settings;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (!storage) return null;
  const choose = async () => {
    setError("");
    try {
      const directory = await open({ directory: true, multiple: false, title: "选择新的数据目录" });
      if (!directory) return;
      setSaving(true);
      await setDataDirectory(directory, beforeMigrate);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };
  const showDirectory = async (path: string) => {
    try {
      await revealItemInDir(path);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };
  return (
    <section className="preference-section storage-settings">
      <div className="section-heading">
        <h2>存储位置</h2>
        {storage.development && <span className="tag">开发环境</span>}
      </div>
      <div className="settings-path-row">
        <div className="settings-path">
          <span>配置目录</span>
          <code>{storage.configDirectory}</code>
        </div>
        <Button onClick={() => void showDirectory(storage.configDirectory)}>打开位置</Button>
      </div>
      <div className="settings-path-row">
        <div className="settings-path">
          <span>数据目录</span>
          <code>{storage.relocatedDataDirectory ?? storage.dataDirectory}</code>
        </div>
        <Button
          onClick={() =>
            void showDirectory(storage.relocatedDataDirectory ?? storage.dataDirectory)
          }
        >
          打开位置
        </Button>
      </div>
      <div className="settings-actions">
        <Button disabled={saving || storage.restartRequired} onClick={() => void choose()}>
          {saving ? "正在等待任务完成并迁移…" : "更改位置"}
        </Button>
        <HelpMarker label="更改存储位置说明">
          请选择空目录。完成后需重启应用，原目录会保留。
        </HelpMarker>
      </div>
      {storage.restartRequired && <Notice>位置已更改，请重启应用。</Notice>}
      {error && <Notice>{error}</Notice>}
      {settings.storageError && (
        <Notice actions={<Button onClick={() => void settings.refreshStorage()}>重新读取</Button>}>
          {settings.storageError}
        </Notice>
      )}
    </section>
  );
}

const sections = [
  { id: "account", name: "账户与连接" },
  { id: "generation", name: "生成与预览" },
  { id: "appearance", name: "外观" },
  { id: "storage", name: "存储" },
] as const;
type SettingsSection = (typeof sections)[number]["id"];

export function SettingsPage({
  settings,
  showAccount = true,
  beforeMigrate,
  onOpenTasks,
}: {
  settings: ApplicationSettingsState;
  showAccount?: boolean;
  beforeMigrate?: () => Promise<void>;
  onOpenTasks?: () => void;
}) {
  const { preferences, writer } = settings;
  const [section, setSection] = useState<SettingsSection>("account");
  const theme = preferences.value?.theme;
  return (
    <main className="settings-page" aria-label="设置">
      <header className="page-toolbar">
        <h1>设置</h1>
      </header>
      <div className="settings-layout">
        <nav className="settings-navigation" aria-label="设置分类">
          {sections.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={section === item.id ? "page" : undefined}
              onClick={() => setSection(item.id)}
            >
              {item.name}
            </button>
          ))}
        </nav>
        <div className="settings-page-content">
          <div hidden={section !== "account"}>
            {showAccount && (
              <section className="preference-section">
                <h2>账户与连接</h2>
                <AccountSettings onOpenTasks={onOpenTasks} />
              </section>
            )}
            <ExecutionSettings settings={settings} />
          </div>
          <section className="preference-section" hidden={section !== "generation"}>
            <h2>生成与预览</h2>
            {preferences.value && (
              <Field label="最近图片数量">
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
          <section className="preference-section" hidden={section !== "appearance"}>
            <h2>外观</h2>
            <div className="preference-row">
              <span>主题</span>
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
                {theme === "dark" ? "切换浅色" : "切换深色"}
              </Button>
            </div>
          </section>
          <div hidden={section !== "storage"}>
            <StorageSettings settings={settings} beforeMigrate={beforeMigrate} />
          </div>
        </div>
      </div>
    </main>
  );
}
