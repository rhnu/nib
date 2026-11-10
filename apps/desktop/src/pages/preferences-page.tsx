import { Row } from "@/shared/ui";

import { useWorkbenchContext } from "@/features/workbench/workbench-context";

export function PreferencesPage() {
  const { options, state } = useWorkbenchContext();
  return (
    <Row gap={0} align="stretch" className="settings-page-slot flex-1 min-h-0">
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
    </Row>
  );
}
