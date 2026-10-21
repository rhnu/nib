import { Workbench } from "../features/workbench/Workbench";
import { GenerationActions, GenerationProvider, GenerationResults } from "../features/generation";
import { StartupScreen } from "./StartupScreen";
import { TitleBar } from "./TitleBar";
import { useTheme } from "./useTheme";
import { useWorkspaceStartup } from "./useWorkspaceStartup";
/** Composition root: application startup and theme, then domain-owned surfaces. */
export default function App() {
  const { theme, toggleTheme } = useTheme();
  const { workspace, loading, error, retry } = useWorkspaceStartup();
  return (
    <div className="application">
      <TitleBar theme={theme} toggleTheme={toggleTheme} workspaceOpen={Boolean(workspace)} />
      {!workspace ? (
        <StartupScreen loading={loading} error={error} retry={retry} />
      ) : (
        <GenerationProvider>
          <Workbench
            workspace={workspace.snapshot}
            initialResources={workspace.resources}
            renderActions={({ draft, readCurrentDraft, resourceVersion }) => (
              <GenerationActions
                draft={draft}
                readCurrentDraft={readCurrentDraft}
                refreshKey={resourceVersion}
              />
            )}
            renderResults={({ onRestore }) => <GenerationResults onRestore={onRestore} />}
          />
        </GenerationProvider>
      )}
    </div>
  );
}
