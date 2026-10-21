import { Workbench } from "../features/workbench/Workbench";
import { GenerationActions, GenerationProvider, GenerationResults } from "../features/generation";
import { StartupScreen } from "./StartupScreen";
import { TitleBar } from "./TitleBar";
import { useTheme } from "./useTheme";
import { useWorkspaceStartup } from "./useWorkspaceStartup";
import { SettingsPage } from "./SettingsPage";
/** Composition root: application startup and theme, then domain-owned surfaces. */
export default function App() {
  const { theme, toggleTheme } = useTheme();
  const { workspace, loading, error, retry } = useWorkspaceStartup();
  return (
    <div className="application">
      {!workspace ? (
        <>
          <TitleBar />
          <StartupScreen loading={loading} error={error} retry={retry} />
        </>
      ) : (
        <GenerationProvider>
          <Workbench
            workspace={workspace.snapshot}
            initialResources={workspace.resources}
            renderHeader={(navigation) => <TitleBar navigation={navigation} />}
            settings={<SettingsPage theme={theme} toggleTheme={toggleTheme} />}
            renderActions={({ draft, readCurrentDraft, resourceVersion, resolved, resolving }) => (
              <GenerationActions
                draft={draft}
                readCurrentDraft={readCurrentDraft}
                refreshKey={resourceVersion}
                resolved={resolved}
                resolving={resolving}
              />
            )}
            renderResults={({ onRestore }) => <GenerationResults onRestore={onRestore} />}
          />
        </GenerationProvider>
      )}
    </div>
  );
}
