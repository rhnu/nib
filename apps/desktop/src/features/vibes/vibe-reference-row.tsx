import {
  Grid,
  Button,
  Field,
  HelpMarker,
  IconButton,
  Modal,
  Notice,
  NumberSlider,
  Toggle,
} from "@/shared/ui";

import {
  MediaInputLayout,
  MediaInputPreview,
  MediaInputTools,
  MediaInputSettings,
} from "@/features/media/media-input-layout";

import { t, useTranslation } from "@/shared/i18n";
import { useId, useState, type ReactNode } from "react";
import { Binary, ImagePlus, Info, RotateCcw } from "lucide-react";
import type {
  ModelCapabilities,
  VibeReferenceInput,
  VibeReferenceOverride,
} from "@/bindings/workbench";

import { AssetImage, useMediaAsset } from "@/features/media";
import { mediaApi } from "@/features/media/api";
import { useMediaQuery } from "@/features/media/use-media-query";
import { VibeMaterialDialog } from "./vibe-material-dialog";
import { VibeAssetDetails } from "./vibe-asset-details";
import { vibeMaterialName, type VibePatch } from "./model";
import { InlineVibeEncoding } from "./inline-vibe-encoding";

/** Each retained material keeps its editing controls and asynchronous encoding feedback together. */
export function VibeReferenceRow({
  value,
  index,
  capabilities,
  onChange,
  actions,
  override,
  onReset,
  issues = [],
}: {
  value: VibeReferenceInput;
  index: number;
  capabilities: ModelCapabilities | null;
  onChange: (patch: VibePatch) => void;
  actions?: ReactNode;
  override?: VibeReferenceOverride;
  onReset?: (field: keyof VibePatch) => void;
  issues?: { field: string; message: string }[];
}) {
  useTranslation();

  const media = useMediaAsset(value.input.assetId);
  const encodedId = value.input.kind === "encoded" ? value.input.assetId : null;
  const inspection = useMediaQuery(
    ["media", "vibe-inspection", encodedId],
    encodedId,
    mediaApi.inspectVibeAsset,
  );
  const original = useMediaAsset(inspection.value?.sourceImageAssetId ?? null);
  const preview = value.input.kind === "image" ? media.asset : original.asset;
  const [picking, setPicking] = useState(false);
  const [details, setDetails] = useState(false);
  const id = useId();
  const label = t("vibes.namedVibe", { value0: index + 1 });

  const reset = (field: keyof VibePatch) =>
    override?.[field] != null && onReset ? (
      <IconButton
        label={t("vibes.revertFieldOverride", {
          value0: label,
          value1:
            field === "strength"
              ? t("vibes.strength")
              : field === "input"
                ? t("vibes.material")
                : t("vibes.enabledState"),
        })}
        onClick={() => onReset(field)}
      >
        <RotateCcw size={13} />
      </IconButton>
    ) : undefined;

  const renderMaterial = (encodingAction?: ReactNode, encodingFeedback?: ReactNode) => (
    <>
      <MediaInputLayout>
        <MediaInputPreview data-vibe-field="input">
          {preview?.kind === "image" ? (
            <AssetImage
              asset={preview}
              alt={label}
              className="vibe-thumbnail block w-[108px] h-[92px] object-contain"
            />
          ) : (
            <Binary size={28} aria-label={t("vibes.encodingMaterial")} />
          )}
          <MediaInputTools aria-label={t("vibes.materialActions", { value0: label })}>
            <IconButton
              label={t("vibes.replaceMaterial", { value0: label })}
              onClick={() => setPicking(true)}
            >
              <ImagePlus size={14} />
            </IconButton>
            {reset("input")}
            {encodingAction}
            <IconButton
              label={t("vibes.viewMaterialInfo", { value0: label })}
              disabled={!media.asset}
              onClick={() => setDetails(true)}
            >
              <Info size={14} />
            </IconButton>
          </MediaInputTools>
        </MediaInputPreview>
        <MediaInputSettings>
          <div data-vibe-field="strength">
            <Field
              label={t("vibes.strengthLabel")}
              htmlFor={`${id}-strength`}
              help={
                <HelpMarker label={t("vibes.strengthHelp")}>
                  {t("vibes.strengthDescription")}
                </HelpMarker>
              }
              actions={reset("strength")}
            >
              <NumberSlider
                id={`${id}-strength`}
                label={t("vibes.referenceStrength", { value0: label })}
                value={value.strength}
                invalid={issues.some((issue) => issue.field === "strength")}
                describedBy={issues.length ? id : undefined}
                onChange={(strength) => onChange({ strength })}
              />
            </Field>
          </div>
          {value.input.kind === "image" && (
            <div data-vibe-field="informationExtracted">
              <Field
                label={t("vibes.informationExtracted")}
                htmlFor={`${id}-information`}
                help={
                  <HelpMarker label={t("vibes.informationHelp")}>
                    {t("vibes.informationDescription")}
                  </HelpMarker>
                }
              >
                <NumberSlider
                  id={`${id}-information`}
                  label={t("vibes.referenceInformation", { value0: label })}
                  value={value.input.informationExtracted}
                  range={
                    capabilities?.vibeReferenceOptions.informationExtracted ?? { min: 0, max: 1 }
                  }
                  invalid={issues.some((issue) => issue.field === "informationExtracted")}
                  describedBy={issues.length ? id : undefined}
                  onChange={(informationExtracted) => {
                    if (value.input.kind === "image")
                      onChange({ input: { ...value.input, informationExtracted } });
                  }}
                />
              </Field>
            </div>
          )}
        </MediaInputSettings>
      </MediaInputLayout>
      {media.loading && (
        <output className="vibe-status text-label text-muted wrap-anywhere">
          {t("vibes.loadingMaterials")}
        </output>
      )}
      {media.asset && !media.asset.available && (
        <p className="vibe-message m-0 text-danger text-label wrap-anywhere" role="alert">
          {t("vibes.materialUnavailable")}
        </p>
      )}
      {media.error && (
        <Notice actions={<Button onClick={media.retry}>{t("vibes.retry")}</Button>}>
          {media.error}
        </Notice>
      )}
      {encodingFeedback}
    </>
  );

  return (
    <Grid
      align="stretch"
      as="article"
      gap={0}
      columns={1}
      minColumnWidth="0px"
      className="vibe-row [&_>_header]:flex [&_>_header]:items-center [&_>_header]:gap-[5px] [&_h4]:m-0 [&_>_header_>_strong]:text-label [&_>_header_.icon-button]:w-[26px] [&_>_header_.icon-button]:min-h-[26px] [&[data-disabled]_>_header_>_strong]:text-muted grid gap-space-3 p-space-3 [border:1px_solid_var(--line)] rounded-control bg-panel min-w-0 media-input-container [container-type:inline-size]"
      data-vibe-id={value.id}
      data-disabled={!value.enabled || undefined}
    >
      <header data-vibe-field="enabled">
        <strong>{label}</strong>
        <span className="vibe-status text-label text-muted wrap-anywhere">
          {value.input.kind === "encoded" ? t("vibes.encoded") : t("vibes.originalImage")}
        </span>
        <span className="flex-1" />
        <Toggle
          label={t("vibes.enableVibe", { value0: label })}
          checked={value.enabled}
          onChange={(enabled) => onChange({ enabled })}
        />
        {reset("enabled")}
        {actions}
      </header>
      {value.input.kind === "image" && capabilities?.encodeVibe ? (
        <InlineVibeEncoding value={value} capabilities={capabilities} onChange={onChange}>
          {renderMaterial}
        </InlineVibeEncoding>
      ) : (
        renderMaterial()
      )}
      {capabilities?.vibeInputPath &&
        ((value.input.kind === "image" && capabilities.vibeInputPath !== "image") ||
          (value.input.kind === "encoded" && capabilities.vibeInputPath === "image")) && (
          <p className="vibe-message m-0 text-danger text-label wrap-anywhere">
            {t("vibes.unsupportedMaterial", {
              material:
                capabilities.vibeInputPath === "image"
                  ? t("vibes.originalImage")
                  : t("vibes.encodedMaterial"),
            })}
          </p>
        )}
      {issues.length > 0 && (
        <output
          id={id}
          className="vibe-message m-0 text-danger text-label wrap-anywhere"
          role="alert"
        >
          {issues.map((issue, index) => (
            <p key={index}>{issue.message}</p>
          ))}
        </output>
      )}
      <Modal
        open={details}
        onClose={() => setDetails(false)}
        title={t("vibes.materialInfoTitle", { value0: label })}
      >
        {details && (
          <div className="vibe-material-details [&_img]:max-w-full [&_img]:max-h-[60vh] [&_img]:object-contain min-w-0 wrap-anywhere">
            {media.asset && <p>{vibeMaterialName(media.asset)}</p>}
            {value.input.kind === "encoded" ? (
              <VibeAssetDetails id={value.input.assetId} />
            ) : (
              preview && <AssetImage asset={preview} alt={label} />
            )}
          </div>
        )}
      </Modal>
      <VibeMaterialDialog
        open={picking}
        onClose={() => setPicking(false)}
        capabilities={capabilities}
        onSelect={(values) => {
          if (values[0]) onChange({ input: values[0].input });
          setPicking(false);
        }}
        single
      />
    </Grid>
  );
}
