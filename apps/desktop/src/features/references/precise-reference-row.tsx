import { t, useTranslation } from "@/shared/i18n";
import { useId, useState, type ReactNode } from "react";
import { ImagePlus, Info, RotateCcw } from "lucide-react";
import type {
  ModelCapabilities,
  PreciseReferenceInput,
  PreciseReferenceOverride,
} from "@/bindings/workbench";
import {
  Button,
  FormField,
  HelpMarker,
  IconButton,
  Modal,
  Notice,
  NumberSlider,
  Select,
  Toggle,
} from "@/shared/ui";
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
      <output id={`${prefix}-${field}-issues`} className="precise-reference-message">
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
    <div className="precise-reference-field" data-reference-field={field}>
      <FormField
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
      </FormField>
    </div>
  );

  const savedTypeUnsupported = !!options && !options.referenceTypes.includes(value.referenceType);
  return (
    <article
      className="precise-reference-row media-input-container"
      data-reference-id={value.id}
      data-disabled={!value.enabled || undefined}
    >
      <header>
        <strong>{label}</strong>
        {override && <span className="tag">{t("references.override")}</span>}
        <span className="spacer" />
        <Toggle
          label={t("references.enableReference", { value0: label })}
          checked={value.enabled}
          onChange={(enabled) => onChange({ enabled })}
        />
        {reset("enabled", t("references.enabledState"))}
        {actions}
      </header>
      {messages("enabled")}
      <div className="media-input-layout">
        <div className="media-input-preview" data-reference-field="assetId">
          {media.asset && <AssetImage asset={media.asset} alt={label} />}
          <fieldset
            className="media-input-tools"
            aria-label={t("references.imageActions", { value0: label })}
          >
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
          </fieldset>
        </div>
        <div className="media-input-settings">
          <div data-reference-field="referenceType">
            <FormField
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
            </FormField>
          </div>
          {numeric("strength", t("references.strengthLabel"), t("references.strengthHelp"))}
          {numeric("fidelity", t("references.fidelityLabel"), t("references.fidelityHelp"))}
          {numeric(
            "informationExtracted",
            t("references.informationExtracted"),
            t("references.informationHelp"),
          )}
        </div>
      </div>
      {media.loading && <output>{t("references.loadingImage")}</output>}
      {media.error && (
        <Notice actions={<Button onClick={media.retry}>{t("references.retryRead")}</Button>}>
          {media.error}
        </Notice>
      )}
      {messages("assetId")}
      {savedTypeUnsupported && (
        <p className="precise-reference-message">{t("references.savedPurposeUnsupported")}</p>
      )}
      <Modal
        open={details}
        onClose={() => setDetails(false)}
        title={t("references.imageInfoTitle", { value0: label })}
      >
        {media.asset && (
          <div className="precise-reference-details">
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
    </article>
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
      <output className="precise-reference-status">{t("references.loadingCapabilities")}</output>
    );
  const messages = preciseReferenceMessages(capabilities);
  return (
    <>
      {messages.precise && <p className="precise-reference-message">{messages.precise}</p>}
      {messages.vibe && capabilities.vibeReference.reason !== "conflictWithPreciseReference" && (
        <p className="precise-reference-message">{messages.vibe}</p>
      )}
    </>
  );
}
