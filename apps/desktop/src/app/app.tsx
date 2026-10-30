import { useEffect, useState } from "react";
import { AccountProvider } from "@/features/generation/account/account-provider";
import { Workbench } from "@/features/workbench/workbench";
import { GenerationActions, GenerationProvider, GenerationResults } from "@/features/generation";
import { StartupScreen } from "./startup-screen";
import { TitleBar } from "./title-bar";
import { useTheme } from "./use-theme";
import { useWorkspaceStartup } from "./use-workspace-startup";
import { SettingsPage } from "./settings-page";
import { useApplicationSettings } from "./use-application-settings";
import { useCloseGuard } from "@/shared/host/use-close-guard";
import { Button, Notice } from "@/shared/ui";
import { errorMessage } from "@/shared/host/error";
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
  const readOnly = settings.migrationPending || Boolean(settings.storage?.restartRequired);
  const settingsNotice = (
    <>
      {settings.migrationPending && (
        <Notice>正在保存编辑、等待已发出的任务完成并迁移数据，请保持窗口打开。</Notice>
      )}
      {settings.storage?.restartRequired && (
        <Notice>数据已迁移并验证。请重启应用；当前窗口已停止保存修改。</Notice>
      )}
      {Boolean(settings.preferences.error) && (
        <Notice
          actions={
            <Button onClick={() => void settings.writer.flush().catch(() => {})}>重试同步</Button>
          }
        >
          应用设置尚未保存：{errorMessage(settings.preferences.error)}
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
    <AccountProvider executionVersion={settings.executionVersion}>
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
                <div inert={readOnly} style={{ display: "contents" }}>
                  <SettingsPage settings={settings} />
                </div>
              ) : (
                <>
                  {error && (
                    <Notice
                      actions={
                        <Button onClick={() => setStartupPage("settings")}>更改存储位置</Button>
                      }
                    >
                      创作数据无法打开。请在设置中检查存储位置与错误信息。原有数据仍保留。
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
          <GenerationProvider
            beforeSubmit={settings.prepareSubmission}
            submissionBlocked={settings.submissionBlocked}
          >
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
              readOnly={readOnly}
              renderSettings={({ beforeMigrate, onOpenTasks }) => (
                <SettingsPage
                  settings={settings}
                  beforeMigrate={beforeMigrate}
                  onOpenTasks={onOpenTasks}
                />
              )}
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
              renderResults={(
                {
                  draft,
                  onRestore,
                  readCurrentDraft,
                  onImageOperation,
                  canMaxEnhance,
                  canInpaint,
                  onViewedAssetChange,
                },
                gallery,
              ) => (
                <GenerationResults
                  onRestore={onRestore}
                  operation={draft.inputs.operation}
                  onImageOperation={onImageOperation}
                  canMaxEnhance={canMaxEnhance}
                  canInpaint={canInpaint}
                  onViewedAssetChange={
                    draft.activePage === (gallery ? "gallery" : "create")
                      ? onViewedAssetChange
                      : undefined
                  }
                  gallery={gallery}
                  recentImageLimit={settings.preferences.value?.recentImageLimit ?? 20}
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
    </AccountProvider>
  );
}
