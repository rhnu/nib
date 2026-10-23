import { useEffect, useState } from "react";
import { Workbench } from "../features/workbench/Workbench";
import { GenerationActions, GenerationProvider, GenerationResults } from "../features/generation";
import { StartupScreen } from "./StartupScreen";
import { TitleBar } from "./TitleBar";
import { useTheme } from "./useTheme";
import { useWorkspaceStartup } from "./useWorkspaceStartup";
import { SettingsPage } from "./SettingsPage";
import { useApplicationSettings } from "./useApplicationSettings";
import { useCloseGuard } from "../shared/host/useCloseGuard";
import { Button, Notice } from "../shared/ui";
import { errorMessage } from "../shared/host/error";
/** Composition root: application startup and theme, then domain-owned surfaces. */
export default function App() {
  const settings = useApplicationSettings();
  useTheme(settings.preferences.value?.theme);
  const { workspace, loading, error, retry } = useWorkspaceStartup(settings.ready);
  const [startupPage, setStartupPage] = useState<"create" | "settings">("create");
  const [closeError, setCloseError] = useState("");
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
  const settingsNotice = (
    <>
      {Boolean(settings.preferences.error) && (
        <Notice
          actions={
            <Button onClick={() => void settings.writer.flush().catch(() => {})}>重试同步</Button>
          }
        >
          外观设置尚未保存：{errorMessage(settings.preferences.error)}
        </Notice>
      )}
      {closeError && (
        <Notice actions={<Button onClick={() => setCloseError("")}>关闭提示</Button>}>
          {closeError}
        </Notice>
      )}
    </>
  );
  return (
    <div className="application">
      {!workspace ? (
        <>
          <TitleBar
            navigation={
              settings.ready && (
                <nav className="desktop-navigation" aria-label="主导航">
                  <Button
                    aria-current={startupPage === "create" ? "page" : undefined}
                    onClick={() => setStartupPage("create")}
                  >
                    创作
                  </Button>
                  <Button
                    aria-current={startupPage === "settings" ? "page" : undefined}
                    onClick={() => setStartupPage("settings")}
                  >
                    设置
                  </Button>
                </nav>
              )
            }
          />
          {settingsNotice}
          {settings.ready ? (
            startupPage === "settings" ? (
              <SettingsPage settings={settings} showAccount={false} />
            ) : (
              <>
                {error && (
                  <Notice
                    actions={
                      <Button onClick={() => setStartupPage("settings")}>更改存储位置</Button>
                    }
                  >
                    创作数据无法打开。可在设置中检查存储位置，取消待迁移更改后重试；新的目录设置于下次启动生效。
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
              loadingLabel="正在同步应用设置…"
            />
          )}
        </>
      ) : (
        <GenerationProvider>
          <Workbench
            workspace={workspace.snapshot}
            initialResources={workspace.resources}
            initialPage={startupPage}
            settingsWriter={settings.closeWriter}
            renderHeader={(navigation) => (
              <>
                <TitleBar navigation={navigation} />
                {settingsNotice}
              </>
            )}
            settings={<SettingsPage settings={settings} />}
            renderActions={({
              draft,
              readCurrentDraft,
              quoteRefreshKey,
              resolved,
              estimate,
              operationPending,
              onFocusField,
            }) => (
              <GenerationActions
                draft={draft}
                readCurrentDraft={readCurrentDraft}
                refreshKey={quoteRefreshKey}
                resolved={resolved}
                estimate={estimate}
                operationPending={operationPending}
                onFocusField={onFocusField}
              />
            )}
            renderResults={({
              draft,
              onRestore,
              readCurrentDraft,
              onImageOperation,
              canMaxEnhance,
              canInpaint,
              onViewedAssetChange,
            }) => (
              <GenerationResults
                onRestore={onRestore}
                operation={draft.inputs.operation}
                onImageOperation={onImageOperation}
                canMaxEnhance={canMaxEnhance}
                canInpaint={canInpaint}
                onViewedAssetChange={onViewedAssetChange}
                onUseSeed={(seed) => {
                  const current = readCurrentDraft();
                  onRestore({ ...current, settings: { ...current.settings, seed } });
                }}
              />
            )}
          />
        </GenerationProvider>
      )}
    </div>
  );
}
