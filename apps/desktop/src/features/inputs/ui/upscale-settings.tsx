import { Grid, Button, Field, Select } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";
import type { CreationOperation, ImageOperationOptions } from "@/bindings/workbench";

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
    <Grid
      align="stretch"
      gap={0}
      columns={1}
      minColumnWidth="0px"
      className="image-operation-fields [&_input]:w-full [&_input]:h-control [&_input]:min-w-0 [&_input]:text-label [&_input]:rounded-control grid gap-[10px] min-w-0"
    >
      <div data-setting-field="upscaleModel">
        <Field label={t("inputs.upscaleModel")}>
          <Select
            {...controlProps("model")}
            value={operation.model}
            onValueChange={(model) => {
              updateOperation((current) =>
                current.kind === "upscale" ? { ...current, model } : current,
              );
            }}
            options={[
              ...(!models.includes(operation.model)
                ? [
                    {
                      value: operation.model,
                      label: `${operation.model}${t("inputs.savedSuffix")}`,
                    },
                  ]
                : []),
              ...models.map((model) => ({ value: model, label: model })),
            ]}
          />
        </Field>
        {messages("model")}
      </div>
      <div data-setting-field="declaredBlurSigma">
        <Field label={t("inputs.blurSigma")}>
          <Select
            {...controlProps("declaredBlurSigma")}
            value={String(operation.declaredBlurSigma)}
            disabled={!options}
            onValueChange={(selected) => {
              const sigma = options?.upscaleBlurSigmas.find((value) => String(value) === selected);
              if (sigma !== undefined)
                updateOperation((current) =>
                  current.kind === "upscale" ? { ...current, declaredBlurSigma: sigma } : current,
                );
            }}
            options={[
              ...(!options?.upscaleBlurSigmas.includes(operation.declaredBlurSigma)
                ? [
                    {
                      value: String(operation.declaredBlurSigma),
                      label: `${operation.declaredBlurSigma}${t("inputs.savedSuffix")}`,
                    },
                  ]
                : []),
              ...(options?.upscaleBlurSigmas.map((sigma) => ({
                value: String(sigma),
                label: String(sigma),
              })) ?? []),
            ]}
          />
        </Field>
        {messages("declaredBlurSigma")}
      </div>
      {optionsError && (
        <div className="inline-warning text-danger text-label leading-[1.7]" role="alert">
          {optionsError}
          <Button variant="quiet" className="" onClick={retryOptions}>
            {t("inputs.retry")}
          </Button>
        </div>
      )}
      {!options && !optionsError && (
        <output className="muted text-muted">{t("inputs.loadingUpscaleOptions")}</output>
      )}
    </Grid>
  );
}
