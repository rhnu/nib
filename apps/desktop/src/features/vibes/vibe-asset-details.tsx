import { Grid, Button, Notice } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";
import type { VibeAssetInspection } from "@/bindings/media";
import { mediaApi } from "@/features/media/api";
import { useMediaQuery } from "@/features/media/use-media-query";

export function VibeAssetInformation({ inspection }: { inspection: VibeAssetInspection }) {
  useTranslation();

  return (
    <>
      <Grid
        columns={1}
        align="stretch"
        as="dl"
        gap={0}
        minColumnWidth="0px"
        className="vibe-identity [&_>_div]:grid [&_>_div]:grid-cols-[80px_minmax(0,_1fr)] [&_>_div]:gap-space-2 [&_dd]:m-0 text-label text-muted wrap-anywhere grid gap-[5px] m-0"
      >
        <div>
          <dt>{t("vibes.model")}</dt>
          <dd>{inspection.modelKey ?? t("vibes.notRecorded")}</dd>
        </div>
        <div>
          <dt>{t("vibes.informationExtracted")}</dt>
          <dd>{inspection.informationExtracted ?? t("vibes.notRecorded")}</dd>
        </div>
        {!inspection.hasSourceImage && (
          <div>
            <dt>{t("vibes.originalImage")}</dt>
            <dd>{t("vibes.originalNotRetained")}</dd>
          </div>
        )}
        {inspection.hasSourceImage && inspection.sourceDocument && (
          <div>
            <dt>{t("vibes.originalImage")}</dt>
            <dd>{t("vibes.storedInDocument")}</dd>
          </div>
        )}
      </Grid>
    </>
  );
}

export function VibeAssetDetails({ id }: { id: string }) {
  useTranslation();

  const view = useMediaQuery(["media", "vibe-inspection", id], id, mediaApi.inspectVibeAsset);
  if (view.loading)
    return (
      <output className="vibe-status text-label text-muted wrap-anywhere">
        {t("vibes.loadingEncodingInfo")}
      </output>
    );
  if (view.error)
    return (
      <Notice actions={<Button onClick={view.retry}>{t("vibes.retry")}</Button>}>
        {view.error}
      </Notice>
    );
  return view.value ? <VibeAssetInformation inspection={view.value} /> : null;
}
