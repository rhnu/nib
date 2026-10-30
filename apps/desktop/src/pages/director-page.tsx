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
    <div className="director-page-slot">
      <DirectorWorkspace
        draft={draft}
        readCurrentDraft={readCurrentDraft}
        onChange={(director) => edit({ ...readCurrentDraft(), director })}
        refreshKey={quoteRefreshKey}
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
    </div>
  );
}
