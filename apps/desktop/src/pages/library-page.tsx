import { ResourceLibrary } from "@/features/library/resource-library";
import { useWorkbenchContext } from "@/features/workbench/workbench-context";

export function LibraryPage() {
  const { workspace, state } = useWorkbenchContext();
  return (
    <ResourceLibrary
      open
      resources={state.resources}
      models={workspace.models}
      onChanged={state.refreshResources}
      ensureResources={state.ensureResources}
      resourceVersion={state.resourceVersion}
    />
  );
}
