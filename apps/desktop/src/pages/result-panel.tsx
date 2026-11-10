import { Col } from "@/shared/ui";

import { GenerationResults } from "@/features/generation";
import { useWorkbenchContext } from "@/features/workbench/workbench-context";

/** Both result surfaces use the same draft and restore/operation coordination. */
export function ResultPanel({ gallery = false }: { gallery?: boolean }) {
  const { extension, options, page } = useWorkbenchContext();
  const { draft, readCurrentDraft, onRestore } = extension;
  return (
    <GenerationResults
      onRestore={onRestore}
      operation={draft.inputs.operation}
      onImageOperation={extension.onImageOperation}
      canMaxEnhance={extension.canMaxEnhance}
      canInpaint={extension.canInpaint}
      onViewedAssetChange={
        page === (gallery ? "gallery" : "create") ? extension.onViewedAssetChange : undefined
      }
      gallery={gallery}
      recentImageLimit={options.recentImageLimit}
      onUseSeed={(seed) => {
        const current = readCurrentDraft();
        onRestore({ ...current, settings: { ...current.settings, seed } });
      }}
    />
  );
}

export function GalleryPage() {
  return (
    <Col gap={0} className="gallery-page-slot flex-1 min-h-0">
      <ResultPanel gallery />
    </Col>
  );
}
