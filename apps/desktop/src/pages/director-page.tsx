import { Row } from "@/shared/ui";

import { DirectorWorkspace } from "@/features/director";
import { useWorkbenchContext } from "@/features/workbench/workbench-context";

export function DirectorPage() {
  const {
    state,
    quoteRefreshKey,
    requestOperation,
    addImageReference,
    encodeImage,
    guardedRestore,
    directorHandoff,
    setDirectorHandoff,
    editorCapabilities,
  } = useWorkbenchContext();
  const { draft, readCurrentDraft, edit } = state;
  return (
    <Row gap={0} align="stretch" className="director-page-slot flex flex-1 min-h-0 min-w-0">
      <DirectorWorkspace
        draft={draft}
        readCurrentDraft={readCurrentDraft}
        onChange={(director) => edit({ ...readCurrentDraft(), director })}
        refreshKey={quoteRefreshKey}
        inputVersion={state.restoreVersion}
        onUseImage={requestOperation}
        onReference={addImageReference}
        onEncodeImage={encodeImage}
        onRestore={guardedRestore}
        handoff={directorHandoff}
        onHandoffComplete={() => setDirectorHandoff(null)}
        canMaxEnhance={editorCapabilities?.maxEnhance ?? false}
        canInpaint={editorCapabilities?.inpainting ?? false}
        canUsePreciseReference={editorCapabilities?.canAddPreciseReference ?? false}
        canUseVibeReference={Boolean(
          editorCapabilities?.canAddVibeReference && editorCapabilities.vibeInputPath === "image",
        )}
      />
    </Row>
  );
}
