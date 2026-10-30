import { t, useTranslation } from "@/shared/i18n";
import { useState } from "react";
import type { ResolvedDraft } from "@/bindings/workbench";
import { AssetImage, useMediaAsset } from "@/features/media";
import { VibeAssetDetails } from "./vibe-asset-details";
import "./vibes.css";

function ImageMaterial({ id }: { id: string }) {
  useTranslation();

  const media = useMediaAsset(id);
  return media.asset ? (
    <AssetImage asset={media.asset} alt={t("vibes.vibeOriginal")} className="vibe-thumbnail" />
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
    <section className="resolved-vibes">
      <h3>
        {t("vibes.vibeHeading")}
        {references.vibes.length}
      </h3>
      <p className="vibe-status">
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
          <article className="vibe-row" key={reference.id}>
            <header>
              <h4>
                {t("vibes.vibePrefix")}
                {index + 1}
              </h4>
              <span className="tag">
                {reference.enabled ? t("vibes.enabled") : t("vibes.disabled")}
              </span>
            </header>
            <dl className="vibe-identity">
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
            </dl>
            {reference.input.kind === "encoded" ? (
              <VibeAssetDetails id={reference.input.assetId} />
            ) : (
              <CollapsedImageMaterial id={reference.input.assetId} />
            )}
          </article>
        );
      })}
    </section>
  );
}
