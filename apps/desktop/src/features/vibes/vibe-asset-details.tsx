import { t, useTranslation } from "@/shared/i18n";
import type { VibeAssetInspection } from "@/bindings/media";
import { mediaApi } from "@/features/media/api";
import { useMediaQuery } from "@/features/media/use-media-query";
import { Button, Notice } from "@/shared/ui";

export function VibeAssetInformation({ inspection }: { inspection: VibeAssetInspection }) {
  useTranslation();

  return (
    <>
      <dl className="vibe-identity">
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
      </dl>
    </>
  );
}

export function VibeAssetDetails({ id }: { id: string }) {
  useTranslation();

  const view = useMediaQuery(["media", "vibe-inspection", id], id, mediaApi.inspectVibeAsset);
  if (view.loading)
    return <output className="vibe-status">{t("vibes.loadingEncodingInfo")}</output>;
  if (view.error)
    return (
      <Notice actions={<Button onClick={view.retry}>{t("vibes.retry")}</Button>}>
        {view.error}
      </Notice>
    );
  return view.value ? <VibeAssetInformation inspection={view.value} /> : null;
}
