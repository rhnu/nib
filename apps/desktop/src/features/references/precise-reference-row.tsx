import {
  Grid,
  Button,
  Field,
  HelpMarker,
  IconButton,
  Modal,
  Notice,
  NumberSlider,
  Select,
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
import { ImagePlus, Info, RotateCcw } from "lucide-react";
import type {
  ModelCapabilities,
  PreciseReferenceInput,
  PreciseReferenceOverride,
} from "@/bindings/workbench";

import { AssetImage, ImagePickerDialog, useMediaAsset } from "@/features/media";
import { imageName } from "@/features/media/model";
import {
  preciseReferenceMessages,
  type PreciseReferenceField,
  type PreciseReferencePatch,
} from "./model";

const typeLabels: Record<string, string> = {
  get character() {
    return t("references.character");
  },
  get style() {
    return t("references.style");
  },
  get "character&style"() {
    return t("references.characterStyle");
  },
  get costume() {
    return t("references.clothing");
  },
  get delta() {
    return t("references.difference");
  },
};

/** Drafts, resources and linked overrides use the same retained reference controls. */
export function PreciseReferenceRow({
  value,
  index,
  capabilities,
  onChange,
  actions,
  override,
  onReset,
  issues = [],
}: {
  value: PreciseReferenceInput;
  index: number;
  capabilities: ModelCapabilities | null;
  onChange: (patch: PreciseReferencePatch) => void;
  actions?: ReactNode;
  override?: PreciseReferenceOverride;
  onReset?: (field: PreciseReferenceField) => void;
  issues?: { field: string; message: string }[];
}) {
  useTranslation();

  const prefix = useId();
  const [picking, setPicking] = useState(false);
  const [details, setDetails] = useState(false);
  const media = useMediaAsset(value.assetId);
  const options = capabilities?.preciseReferenceOptions;
  const label = t("references.namedPreciseReference", { value0: index + 1 });

  const hasIssue = (field: string) => issues.some((issue) => issue.field === field);

  const messages = (field: string) =>
    hasIssue(field) ? (
      <output
        id={`${prefix}-${field}-issues`}
        className="precise-reference-message [&_p]:m-0 m-0 text-danger text-caption leading-[1.6]"
      >
        {issues
          .filter((issue) => issue.field === field)
          .map((issue, index) => (
            <p key={index}>{issue.message}</p>
          ))}
      </output>
    ) : null;

  const reset = (field: PreciseReferenceField, name: string) =>
    override?.[field] != null && onReset ? (
      <IconButton
        label={t("references.revertOverride", { value0: name })}
        onClick={() => onReset(field)}
      >
        <RotateCcw size={13} />
      </IconButton>
    ) : undefined;

  const numeric = (
    field: "strength" | "fidelity" | "informationExtracted",
    name: string,
    help: string,
  ) => (
    <div className="precise-reference-field min-w-0" data-reference-field={field}>
      <Field
        label={name}
        htmlFor={`${prefix}-${field}`}
        help={
          <HelpMarker label={t("references.referenceHelp", { value0: name })}>{help}</HelpMarker>
        }
        actions={reset(field, name)}
        feedback={messages(field)}
      >
        <NumberSlider
          id={`${prefix}-${field}`}
          label={`${label}${name}`}
          value={value[field]}
          range={
            field === "informationExtracted"
              ? (options?.informationExtracted ?? { min: 0, max: 1 })
              : undefined
          }
          invalid={hasIssue(field)}
          describedBy={hasIssue(field) ? `${prefix}-${field}-issues` : undefined}
          onChange={(number) => onChange({ [field]: number })}
        />
      </Field>
    </div>
  );

  const savedTypeUnsupported = !!options && !options.referenceTypes.includes(value.referenceType);
  return (
    <Grid
      align="stretch"
      as="article"
      gap={0}
      columns={1}
      minColumnWidth="0px"
      className="precise-reference-row [&_>_header]:flex [&_>_header]:items-center [&_>_header]:gap-[5px] [&_>_header]:min-w-0 [&_>_header_>_strong]:text-label [&[data-disabled]_>_header_>_strong]:text-muted [&_>_header_.icon-button]:w-[26px] [&_>_header_.icon-button]:min-h-[26px] [&_:is(input,_select)[aria-invalid='true']]:border-danger grid min-w-0 gap-space-3 p-space-3 [border:1px_solid_var(--line)] rounded-control bg-panel media-input-container [container-type:inline-size]"
      data-reference-id={value.id}
      data-disabled={!value.enabled || undefined}
    >
      <header>
        <strong>{label}</strong>
        {override && (
          <span className="tag inline-flex items-center p-[1px_5px] leading-[19px] text-[10px] rounded-control bg-accent-soft text-accent whitespace-nowrap">
            {t("references.override")}
          </span>
        )}
        <span className="flex-1" />
        <Toggle
          label={t("references.enableReference", { value0: label })}
          checked={value.enabled}
          onChange={(enabled) => onChange({ enabled })}
        />
        {reset("enabled", t("references.enabledState"))}
        {actions}
      </header>
      {messages("enabled")}
      <MediaInputLayout>
        <MediaInputPreview data-reference-field="assetId">
          {media.asset && <AssetImage asset={media.asset} alt={label} />}
          <MediaInputTools aria-label={t("references.imageActions", { value0: label })}>
            <IconButton
              label={t("references.replaceImage", { value0: label })}
              aria-invalid={hasIssue("assetId") || undefined}
              onClick={() => setPicking(true)}
            >
              <ImagePlus size={14} />
            </IconButton>
            {reset("assetId", t("references.image"))}
            <IconButton
              label={t("references.viewImageInfo", { value0: label })}
              disabled={!media.asset}
              onClick={() => setDetails(true)}
            >
              <Info size={14} />
            </IconButton>
          </MediaInputTools>
        </MediaInputPreview>
        <MediaInputSettings>
          <div data-reference-field="referenceType">
            <Field
              label={t("references.purpose")}
              htmlFor={`${prefix}-type`}
              actions={reset("referenceType", t("references.purpose"))}
              feedback={messages("referenceType")}
            >
              <Select
                id={`${prefix}-type`}
                value={value.referenceType}
                aria-invalid={hasIssue("referenceType") || undefined}
                aria-describedby={
                  hasIssue("referenceType") ? `${prefix}-referenceType-issues` : undefined
                }
                onValueChange={(referenceType) => onChange({ referenceType })}
                options={[
                  ...(!options?.referenceTypes.includes(value.referenceType)
                    ? [
                        {
                          value: value.referenceType,
                          label: `${typeLabels[value.referenceType] ?? value.referenceType}${t("references.savedTag")}`,
                        },
                      ]
                    : []),
                  ...(options?.referenceTypes.map((type) => ({
                    value: type,
                    label: typeLabels[type] ?? type,
                  })) ?? []),
                ]}
              />
            </Field>
          </div>
          {numeric("strength", t("references.strengthLabel"), t("references.strengthHelp"))}
          {numeric("fidelity", t("references.fidelityLabel"), t("references.fidelityHelp"))}
          {numeric(
            "informationExtracted",
            t("references.informationExtracted"),
            t("references.informationHelp"),
          )}
        </MediaInputSettings>
      </MediaInputLayout>
      {media.loading && <output>{t("references.loadingImage")}</output>}
      {media.error && (
        <Notice actions={<Button onClick={media.retry}>{t("references.retryRead")}</Button>}>
          {media.error}
        </Notice>
      )}
      {messages("assetId")}
      {savedTypeUnsupported && (
        <p className="precise-reference-message [&_p]:m-0 m-0 text-danger text-caption leading-[1.6]">
          {t("references.savedPurposeUnsupported")}
        </p>
      )}
      <Modal
        open={details}
        onClose={() => setDetails(false)}
        title={t("references.imageInfoTitle", { value0: label })}
      >
        {media.asset && (
          <div className="precise-reference-details [&_img]:max-w-full [&_img]:max-h-[60vh] [&_img]:object-contain min-w-0 wrap-anywhere">
            <AssetImage asset={media.asset} alt={label} />
            <p>{imageName(media.asset)}</p>
            <p>
              {media.asset.width} × {media.asset.height} · {media.asset.mimeType}
            </p>
          </div>
        )}
      </Modal>
      <ImagePickerDialog
        open={picking}
        title={t("references.choosePreciseImage")}
        onClose={() => setPicking(false)}
        onSelect={(asset) => onChange({ assetId: asset.id })}
      />
    </Grid>
  );
}

export function PreciseReferenceAvailability({
  capabilities,
}: {
  capabilities: ModelCapabilities | null;
}) {
  useTranslation();

  if (!capabilities)
    return (
      <output className="precise-reference-status m-0 text-muted text-caption leading-[1.6] wrap-anywhere">
        {t("references.loadingCapabilities")}
      </output>
    );
  const messages = preciseReferenceMessages(capabilities);
  return (
    <>
      {messages.precise && (
        <p className="precise-reference-message [&_p]:m-0 m-0 text-danger text-caption leading-[1.6]">
          {messages.precise}
        </p>
      )}
      {messages.vibe && capabilities.vibeReference.reason !== "conflictWithPreciseReference" && (
        <p className="precise-reference-message [&_p]:m-0 m-0 text-danger text-caption leading-[1.6]">
          {messages.vibe}
        </p>
      )}
    </>
  );
}
