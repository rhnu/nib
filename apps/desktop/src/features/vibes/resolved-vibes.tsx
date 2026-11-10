import { Grid } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";
import { useState } from "react";
import type { ResolvedDraft } from "@/bindings/workbench";
import { AssetImage, useMediaAsset } from "@/features/media";
import { VibeAssetDetails } from "./vibe-asset-details";

function ImageMaterial({ id }: { id: string }) {
  useTranslation();

  const media = useMediaAsset(id);
  return media.asset ? (
    <AssetImage
      asset={media.asset}
      alt={t("vibes.vibeOriginal")}
      className="vibe-thumbnail block w-[108px] h-[92px] object-contain"
    />
  ) : (
    <output>{media.error ?? t("vibes.loadingOriginal")}</output>
  );
}

function CollapsedImageMaterial({ id }: { id: string }) {
  useTranslation();

  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t("vibes.viewOriginal")}</summary>
      {open && <ImageMaterial id={id} />}
    </details>
  );
}

export function ResolvedVibes({ resolved }: { resolved: ResolvedDraft }) {
  useTranslation();

  const references = resolved.inputs.references;
  if (!references.vibes.length) return null;
  return (
    <Grid
      align="stretch"
      as="section"
      gap={0}
      columns={1}
      minColumnWidth="0px"
      className="resolved-vibes grid gap-space-3 min-w-0"
    >
      <h3>
        {t("vibes.vibeHeading")}
        {references.vibes.length}
      </h3>
      <p className="vibe-status text-label text-muted wrap-anywhere">
        {t("vibes.normalizationPrefix")}
        {references.normalizeVibeStrength === null
          ? t("vibes.default")
          : references.normalizeVibeStrength
            ? t("vibes.on")
            : t("vibes.off")}
      </p>
      {references.vibes.map((reference, index) => {
        const source = resolved.inputSources.find((item) => item.id === reference.id);
        return (
          <Grid
            align="stretch"
            as="article"
            gap={0}
            columns={1}
            minColumnWidth="0px"
            className="vibe-row [&_>_header]:flex [&_>_header]:items-center [&_>_header]:gap-[5px] [&_h4]:m-0 [&_>_header_>_strong]:text-label [&_>_header_.icon-button]:w-[26px] [&_>_header_.icon-button]:min-h-[26px] [&[data-disabled]_>_header_>_strong]:text-muted grid gap-space-3 p-space-3 [border:1px_solid_var(--line)] rounded-control bg-panel min-w-0"
            key={reference.id}
          >
            <header>
              <h4>
                {t("vibes.vibePrefix")}
                {index + 1}
              </h4>
              <span className="tag inline-flex items-center p-[1px_5px] leading-[19px] text-[10px] rounded-control bg-accent-soft text-accent whitespace-nowrap">
                {reference.enabled ? t("vibes.enabled") : t("vibes.disabled")}
              </span>
            </header>
            <Grid
              columns={1}
              align="stretch"
              as="dl"
              gap={0}
              minColumnWidth="0px"
              className="vibe-identity [&_>_div]:grid [&_>_div]:grid-cols-[80px_minmax(0,_1fr)] [&_>_div]:gap-space-2 [&_dd]:m-0 text-label text-muted wrap-anywhere grid gap-[5px] m-0"
            >
              <div>
                <dt>{t("vibes.strength")}</dt>
                <dd>{reference.strength}</dd>
              </div>
              <div>
                <dt>{t("vibes.material")}</dt>
                <dd>
                  {reference.input.kind === "image"
                    ? t("vibes.originalImage")
                    : t("vibes.encodedMaterial")}
                </dd>
              </div>
              {reference.input.kind === "image" && (
                <div>
                  <dt>{t("vibes.informationExtracted")}</dt>
                  <dd>{reference.input.informationExtracted}</dd>
                </div>
              )}
              <div>
                <dt>{t("vibes.source")}</dt>
                <dd>
                  {source?.presetInstanceId ? t("vibes.presetOutput") : t("vibes.currentCreation")}
                  {source?.expanded && t("vibes.expandedTag")}
                  {source?.overridden && t("vibes.instanceOverrideTag")}
                </dd>
              </div>
            </Grid>
            {reference.input.kind === "encoded" ? (
              <VibeAssetDetails id={reference.input.assetId} />
            ) : (
              <CollapsedImageMaterial id={reference.input.assetId} />
            )}
          </Grid>
        );
      })}
    </Grid>
  );
}
