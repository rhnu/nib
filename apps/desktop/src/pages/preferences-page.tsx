import { useWorkbenchContext } from "@/features/workbench/workbench-context";

export function PreferencesPage() {
  const { options, state } = useWorkbenchContext();
  return (
    <div className="settings-page-slot">
      {options.renderSettings({
        beforeMigrate: state.prepareMigration,
        onOpenTasks: () => {
          void options.navigate("create").then(() => {
            requestAnimationFrame(() =>
              document.querySelector<HTMLButtonElement>("[data-generation-tasks]")?.click(),
            );
          });
        },
      })}
    </div>
  );
}
