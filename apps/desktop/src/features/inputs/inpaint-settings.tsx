import { t, useTranslation, errorMessage } from "@/shared/i18n";
import { useId, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { X } from "lucide-react";
import type { ParameterDiagnostic } from "@/bindings/generation";
import type {
  CreationOperation,
  ImageOperationOptions,
  ModelCapabilities,
} from "@/bindings/workbench";
import {
  Button,
  Field,
  FormField,
  FormGrid,
  NumberSlider,
  HelpMarker,
  Modal,
  Toggle,
} from "@/shared/ui";
import { optionalImageSeed } from "./image-operation";

type InpaintOperation = Extract<CreationOperation, { kind: "inpainting" }>;

/** Pure infilling and explicit source conditioning are different SDK inputs. */
export function InpaintSettings({
  operation,
  capabilities,
  defaults,
  optionsError,
  retryOptions,
  diagnostics,
  errorFields,
  update,
}: {
  operation: InpaintOperation;
  capabilities: ModelCapabilities | null;
  defaults: ImageOperationOptions["inpaintConditioning"] | null;
  optionsError: string | null;
  retryOptions: () => void;
  diagnostics: ParameterDiagnostic[];
  errorFields: string[];
  update: (change: (current: InpaintOperation) => InpaintOperation) => void;
}) {
  useTranslation();

  const prefix = useId();
  const [confirmPure, setConfirmPure] = useState(false);

  const normalize = (field: string) => field.replaceAll("_", "").toLowerCase().split(".").at(-1);

  const diagnostic = (field: string) =>
    diagnostics.filter((item) => normalize(item.field) === field.toLowerCase());

  const rejected = (field: string) =>
    errorFields.some((item) => normalize(item) === field.toLowerCase());

  const props = (field: string) => ({
    "aria-invalid": rejected(field) || undefined,
    "aria-describedby":
      diagnostic(field).length || rejected(field) ? `${prefix}-${field}` : undefined,
  });

  const messages = (field: string) =>
    diagnostic(field).length || rejected(field) ? (
      <output className="image-operation-diagnostic" id={`${prefix}-${field}`}>
        {diagnostic(field).map((item, index) => (
          <span key={index}>{errorMessage(item.change)}</span>
        ))}
        {rejected(field) && <span>{t("inputs.fieldRejected")}</span>}
      </output>
    ) : null;

  const numeric = (field: "strength" | "noise", raw: string) => {
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value)) return;
    update((current) =>
      current.img2img ? { ...current, img2img: { ...current.img2img, [field]: value } } : current,
    );
  };

  const conditioning = operation.img2img;
  return (
    <div className="image-operation-fields">
      {capabilities?.inpainting === false && (
        <p className="inline-warning" role="alert">
          {t("inputs.inpaintingUnsupported")}
        </p>
      )}
      {conditioning && capabilities?.inpaintingImageToImage === false && (
        <p className="inline-warning" role="alert">
          {t("inputs.regionalConditioningUnsupported")}
        </p>
      )}
      <div data-setting-field="img2img">
        <div className="setting-label">
          <span>{t("inputs.regionalConditioning")}</span>
          <HelpMarker label={t("inputs.regionalConditioningHelpTitle")}>
            {t("inputs.regionalConditioningHelp")}
          </HelpMarker>
        </div>
        <select
          aria-label={t("inputs.regionalConditioning")}
          {...props("img2img")}
          value={conditioning ? "conditioned" : "pure"}
          onChange={(event) => {
            if (event.target.value === "pure") setConfirmPure(true);
            else if (defaults) update((current) => ({ ...current, img2img: { ...defaults } }));
          }}
        >
          <option value="pure">{t("inputs.pureInpainting")}</option>
          <option
            value="conditioned"
            disabled={
              capabilities?.inpaintingImageToImage === false || (!defaults && !conditioning)
            }
          >
            {t("inputs.regionalImageToImage")}
          </option>
        </select>
        {messages("img2img")}
      </div>
      {!defaults &&
        capabilities?.inpaintingImageToImage &&
        (optionsError ? (
          <div className="inline-warning" role="alert">
            {optionsError}
            <Button className="quiet" onClick={retryOptions}>
              {t("inputs.retry")}
            </Button>
          </div>
        ) : (
          <output className="muted">{t("inputs.loadingConditioningOptions")}</output>
        ))}
      {conditioning && (
        <>
          <FormGrid>
            {(["strength", "noise"] as const).map((field) => {
              const range =
                capabilities?.ranges[field === "strength" ? "inpaintStrength" : "img2imgNoise"];
              const label = field === "strength" ? t("inputs.strength") : t("inputs.noise");
              return (
                <div key={field} data-setting-field={field}>
                  <FormField
                    label={label}
                    htmlFor={`${prefix}-${field}-input`}
                    feedback={messages(field)}
                  >
                    <NumberSlider
                      id={`${prefix}-${field}-input`}
                      label={label}
                      value={conditioning[field]}
                      range={range}
                      sliderRange={range}
                      invalid={rejected(field)}
                      describedBy={props(field)["aria-describedby"]}
                      onChange={(value) => numeric(field, String(value))}
                    />
                  </FormField>
                </div>
              );
            })}
          </FormGrid>
        </>
      )}
      <Popover.Portal>
        <Popover.Positioner
          side="right"
          align="start"
          sideOffset={8}
          className="image-input-positioner"
        >
          <Popover.Popup className="image-input-popup" initialFocus={false}>
            <header>
              <Popover.Title>{t("inputs.advancedInpaint")}</Popover.Title>
              <Popover.Close className="icon-button" aria-label={t("inputs.closeAdvancedInpaint")}>
                <X size={14} />
              </Popover.Close>
            </header>
            <div className="image-operation-fields">
              {conditioning && (
                <>
                  <fieldset
                    className="image-operation-toggle"
                    data-setting-field="colorCorrect"
                    aria-label={t("inputs.colorCorrect")}
                    {...props("colorCorrect")}
                  >
                    <span>{t("inputs.colorCorrect")}</span>
                    <Toggle
                      label={t("inputs.colorCorrect")}
                      checked={conditioning.color_correct}
                      onChange={(color_correct) =>
                        update((current) =>
                          current.img2img
                            ? { ...current, img2img: { ...current.img2img, color_correct } }
                            : current,
                        )
                      }
                    />
                    {messages("colorCorrect")}
                  </fieldset>
                  <div data-setting-field="extraNoiseSeed">
                    <Field label={t("inputs.extraNoiseSeed")}>
                      <input
                        {...props("extraNoiseSeed")}
                        type="number"
                        step={1}
                        placeholder={t("inputs.inheritSeedHint")}
                        value={conditioning.extra_noise_seed ?? ""}
                        onChange={(event) => {
                          const extra_noise_seed = optionalImageSeed(event.target.value);
                          update((current) =>
                            current.img2img
                              ? { ...current, img2img: { ...current.img2img, extra_noise_seed } }
                              : current,
                          );
                        }}
                      />
                    </Field>
                    {messages("extraNoiseSeed")}
                  </div>
                </>
              )}
              <fieldset
                className="image-operation-toggle"
                data-setting-field="addOriginalImage"
                aria-label={t("inputs.keepOutsideMask")}
                {...props("addOriginalImage")}
              >
                <span>{t("inputs.keepOutsideMask")}</span>
                <Toggle
                  label={t("inputs.keepOutsideMask")}
                  checked={operation.addOriginalImage}
                  onChange={(addOriginalImage) =>
                    update((current) => ({ ...current, addOriginalImage }))
                  }
                />
                {messages("addOriginalImage")}
              </fieldset>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
      <Modal
        open={confirmPure}
        onClose={() => setConfirmPure(false)}
        title={t("inputs.switchToPureTitle")}
      >
        <p className="confirm-copy">{t("inputs.switchToPureWarning")}</p>
        <div className="dialog-actions">
          <Button onClick={() => setConfirmPure(false)}>{t("inputs.cancel")}</Button>
          <Button
            className="primary"
            onClick={() => {
              update((current) => ({ ...current, img2img: null }));
              setConfirmPure(false);
            }}
          >
            {t("inputs.usePureInpainting")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
