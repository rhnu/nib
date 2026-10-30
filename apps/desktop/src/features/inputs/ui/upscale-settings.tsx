import { t, useTranslation } from "@/shared/i18n";
import type { CreationOperation, ImageOperationOptions } from "@/bindings/workbench";
import { Button, Field } from "@/shared/ui";
import type { ImageOperationFeedback } from "./image-operation-feedback";

/** Upscale consumes only its model and SDK blur options. */
export function UpscaleSettings({
  operation,
  models,
  options,
  optionsError,
  retryOptions,
  feedback,
  updateOperation,
}: {
  operation: Extract<CreationOperation, { kind: "upscale" }>;
  models: string[];
  options: ImageOperationOptions | null;
  optionsError: string | null;
  retryOptions: () => void;
  feedback: ImageOperationFeedback;
  updateOperation: (change: (current: CreationOperation) => CreationOperation) => void;
}) {
  useTranslation();

  const { messages, controlProps } = feedback;
  return (
    <div className="image-operation-fields">
      <div data-setting-field="upscaleModel">
        <Field label={t("inputs.upscaleModel")}>
          <select
            {...controlProps("model")}
            value={operation.model}
            onChange={(event) => {
              const model = event.target.value;
              updateOperation((current) =>
                current.kind === "upscale" ? { ...current, model } : current,
              );
            }}
          >
            {!models.includes(operation.model) && (
              <option value={operation.model}>
                {operation.model}
                {t("inputs.savedSuffix")}
              </option>
            )}
            {models.map((model) => (
              <option value={model} key={model}>
                {model}
              </option>
            ))}
          </select>
        </Field>
        {messages("model")}
      </div>
      <div data-setting-field="declaredBlurSigma">
        <Field label={t("inputs.blurSigma")}>
          <select
            {...controlProps("declaredBlurSigma")}
            value={operation.declaredBlurSigma}
            disabled={!options}
            onChange={(event) => {
              const sigma = options?.upscaleBlurSigmas.find(
                (value) => String(value) === event.target.value,
              );
              if (sigma !== undefined)
                updateOperation((current) =>
                  current.kind === "upscale" ? { ...current, declaredBlurSigma: sigma } : current,
                );
            }}
          >
            {!options?.upscaleBlurSigmas.includes(operation.declaredBlurSigma) && (
              <option value={operation.declaredBlurSigma}>
                {operation.declaredBlurSigma}
                {t("inputs.savedSuffix")}
              </option>
            )}
            {options?.upscaleBlurSigmas.map((sigma) => (
              <option key={sigma} value={sigma}>
                {sigma}
              </option>
            ))}
          </select>
        </Field>
        {messages("declaredBlurSigma")}
      </div>
      {optionsError && (
        <div className="inline-warning" role="alert">
          {optionsError}
          <Button className="quiet" onClick={retryOptions}>
            {t("inputs.retry")}
          </Button>
        </div>
      )}
      {!options && !optionsError && (
        <output className="muted">{t("inputs.loadingUpscaleOptions")}</output>
      )}
    </div>
  );
}
