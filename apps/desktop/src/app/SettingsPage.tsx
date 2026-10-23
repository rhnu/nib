import { useState } from "react";
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

function StorageSettings({ settings }: { settings: ApplicationSettingsState }) {
  const { storage, setDataDirectory } = settings;
  const [directory, setDirectory] = useState(
    () => storage?.pendingDataDirectory ?? storage?.dataDirectory ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (!storage) return null;
  const save = async (value: string | null) => {
    setSaving(true);
    setError("");
    try {
      await setDataDirectory(value);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };
  const selectedDirectory = storage.pendingDataDirectory ?? storage.dataDirectory;
  return (
    <section className="preference-section storage-settings">
      <div className="section-heading">
        <h2>存储位置</h2>
        {storage.development && <span className="tag">开发环境</span>}
      </div>
      <p className="settings-description">
        应用设置全局保存。创作数据库与图片保存在同一个数据目录中。
        {storage.development && "当前使用项目内的独立开发数据，不影响正式版。"}
      </p>
      <Field label="配置目录（固定）">
        <input readOnly value={storage.configDirectory} />
      </Field>
      <Field label="当前数据目录">
        <input readOnly value={storage.dataDirectory} />
      </Field>
      {storage.pendingDataDirectory && (
        <output className="settings-pending">
          下次启动迁移到：<span>{storage.pendingDataDirectory}</span>
        </output>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save(directory.trim());
        }}
      >
        <Field label="新的数据目录（绝对路径）">
          <input
            value={directory}
            onChange={(event) => setDirectory(event.target.value)}
            disabled={saving}
            required
            aria-describedby="data-directory-help"
          />
        </Field>
        <p className="settings-description" id="data-directory-help">
          保存后于下次启动复制现有数据并使用新目录，原目录保留。目标目录必须为空。
        </p>
        <div className="settings-actions">
          <Button
            type="submit"
            disabled={saving || !directory.trim() || directory.trim() === selectedDirectory}
          >
            {saving ? "正在保存…" : "保存存储位置"}
          </Button>
          <Button
            type="button"
            disabled={saving || selectedDirectory === storage.defaultDataDirectory}
            onClick={() => void save(null)}
          >
            恢复默认位置
          </Button>
          {storage.pendingDataDirectory && (
            <Button
              type="button"
              disabled={saving}
              onClick={() => void save(storage.dataDirectory)}
            >
              取消待生效更改
            </Button>
          )}
        </div>
      </form>
      {error && <Notice>{error}</Notice>}
      {settings.storageError && (
        <Notice actions={<Button onClick={() => void settings.refreshStorage()}>重新读取</Button>}>
          无法刷新存储位置：{settings.storageError}
        </Notice>
      )}
    </section>
  );
}

export function SettingsPage({
  settings,
  showAccount = true,
}: {
  settings: ApplicationSettingsState;
  showAccount?: boolean;
}) {
  const { preferences, writer } = settings;
  const theme = preferences.value?.theme;
  return (
    <main className="settings-page" aria-label="设置">
      <header className="page-toolbar">
        <h1>设置</h1>
      </header>
      <div className="settings-page-content">
        {showAccount && (
          <section className="preference-section">
            <h2>账户</h2>
            <AccountSettings />
          </section>
        )}
        <section className="preference-section">
          <h2>外观</h2>
          <div className="preference-row">
            <span>主题</span>
            <Button
              disabled={!theme}
              onClick={() => {
                if (preferences.value)
                  writer.edit({ ...preferences.value, theme: theme === "dark" ? "light" : "dark" });
              }}
            >
              {theme === "dark" ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
              {theme === "dark" ? "切换浅色" : "切换深色"}
            </Button>
          </div>
        </section>
        <ExecutionSettings settings={settings} />
        <StorageSettings
          key={`${settings.storage?.dataDirectory}:${settings.storage?.pendingDataDirectory}`}
          settings={settings}
        />
      </div>
    </main>
  );
}
