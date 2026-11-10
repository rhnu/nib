import { IconButton, Row } from "@/shared/ui";

import { Expand, ExternalLink, ImagePlus, Info, ScanFace, Waves } from "lucide-react";
import type { ExploreSummary } from "@/bindings/explore";
import type { ImageExportFormat } from "@/bindings/media";
import { ImageFormatMenu } from "@/features/media/image-export";

import { t, useTranslation } from "@/shared/i18n";

export type ExploreImageActions = {
  busy: boolean;
  useImage: (item: ExploreSummary, kind: "source" | "precise" | "vibe") => void;
  saveImage: (item: ExploreSummary, format: ImageExportFormat) => void;
  copyImage: (item: ExploreSummary, format: ImageExportFormat) => void;
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
    <Row
      gap={0}
      align="stretch"
      className="explore-image-actions absolute [right:6px] [bottom:36px] gap-[2px] p-[3px] rounded-overlay bg-raised [border:1px_solid_var(--line)] [box-shadow:0_2px_8px_#0003] [opacity:0] [transition:opacity_120ms] [&_.icon-button]:[width:28px] [&_.icon-button]:[min-width:28px] [&_.icon-button]:[height:28px] [&_.icon-button]:p-space-1 [&_.icon-button]:[border:0] max-[700px]:[opacity:1] [@media(prefers-reduced-motion:_reduce)]:[transition:none]"
    >
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
      <ImageFormatMenu
        action="save"
        disabled={actions.busy}
        onSelect={(format) => actions.saveImage(item, format)}
      />
      <ImageFormatMenu
        action="copy"
        disabled={actions.busy}
        onSelect={(format) => actions.copyImage(item, format)}
      />
      <IconButton label={t("explore.openWebsite")} onClick={() => actions.openWebsite(item)}>
        <ExternalLink size={16} aria-hidden />
      </IconButton>
    </Row>
  );
}
