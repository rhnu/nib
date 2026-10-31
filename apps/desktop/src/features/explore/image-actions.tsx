import { Download, Expand, ExternalLink, ImagePlus, Info, ScanFace, Waves } from "lucide-react";
import type { ExploreSummary } from "@/bindings/explore";
import { IconButton } from "@/shared/ui";
import { t, useTranslation } from "@/shared/i18n";

export type ExploreImageActions = {
  busy: boolean;
  useImage: (item: ExploreSummary, kind: "source" | "precise" | "vibe") => void;
  saveImage: (item: ExploreSummary) => void;
  openWebsite: (item: ExploreSummary) => void;
  precise: boolean;
  vibe: boolean;
};

/** One compact icon row belongs to the image it operates on. */
export function ExploreImageActions({
  item,
  actions,
  onInspect,
  onExpand,
  references = false,
}: {
  item: ExploreSummary;
  actions: ExploreImageActions;
  onInspect?: () => void;
  onExpand?: () => void;
  references?: boolean;
}) {
  useTranslation();
  return (
    <div className="explore-image-actions">
      {onExpand && (
        <IconButton label={t("explore.viewLarge")} onClick={onExpand}>
          <Expand size={16} aria-hidden />
        </IconButton>
      )}
      {onInspect && (
        <IconButton label={t("explore.inspect")} onClick={onInspect}>
          <Info size={16} aria-hidden />
        </IconButton>
      )}
      <IconButton
        label={t("generation.useAsSource")}
        disabled={actions.busy}
        onClick={() => actions.useImage(item, "source")}
      >
        <ImagePlus size={16} aria-hidden />
      </IconButton>
      {references && actions.precise && (
        <IconButton
          label={t("explore.usePrecise")}
          disabled={actions.busy}
          onClick={() => actions.useImage(item, "precise")}
        >
          <ScanFace size={16} aria-hidden />
        </IconButton>
      )}
      {references && actions.vibe && (
        <IconButton
          label={t("explore.useVibe")}
          disabled={actions.busy}
          onClick={() => actions.useImage(item, "vibe")}
        >
          <Waves size={16} aria-hidden />
        </IconButton>
      )}
      <IconButton
        label={t("explore.saveImage")}
        disabled={actions.busy}
        onClick={() => actions.saveImage(item)}
      >
        <Download size={16} aria-hidden />
      </IconButton>
      <IconButton label={t("explore.openWebsite")} onClick={() => actions.openWebsite(item)}>
        <ExternalLink size={16} aria-hidden />
      </IconButton>
    </div>
  );
}
