import { Grid, Field, NumberSlider } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";
import type { GenerationQuote } from "@/bindings/generation";
import type { CreationOperation, ModelCapabilities } from "@/bindings/workbench";

import { ImageToImageAdvancedSettings } from "./image-to-image-advanced-settings";
import type { ImageOperationFeedback } from "./image-operation-feedback";

type ImageToImageOperation = Extract<CreationOperation, { kind: "imageToImage" }>;

export interface ImageToImageSettingsProps {
  operation: ImageToImageOperation;
  capabilities: ModelCapabilities | null;
  estimate: GenerationQuote | null;
  feedback: ImageOperationFeedback;
  updateOperation: (change: (current: CreationOperation) => CreationOperation) => void;
}

/** Displays SDK geometry and the strength/noise controls for ordinary and Max Enhance inputs. */
export function ImageToImageSettings({
  operation,
  capabilities,
  estimate,
  feedback,
  updateOperation,
}: ImageToImageSettingsProps) {
  useTranslation();

  const { prefix, messages, rejected, controlProps } = feedback;
  const effectiveOperation = estimate?.resolved?.inputs.operation;
  const geometry =
    effectiveOperation?.kind === "imageToImage" && effectiveOperation.maxEnhance
      ? estimate?.geometry
      : null;

  const numeric = (field: "strength" | "noise", raw: string) => {
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value)) return;
    updateOperation((current) =>
      current.kind === "imageToImage" ? { ...current, [field]: value } : current,
    );
  };

  return (
    <Grid
      align="stretch"
      gap={0}
      columns={1}
      minColumnWidth="0px"
      className="image-operation-fields [&_input]:w-full [&_input]:h-control [&_input]:min-w-0 [&_input]:text-label [&_input]:rounded-control grid gap-[10px] min-w-0"
    >
      {operation.maxEnhance && (
        <>
          {capabilities?.maxEnhance === false && (
            <p className="inline-warning text-danger text-label leading-[1.7]" role="alert">
              {t("inputs.maxEnhanceUnsupported")}
            </p>
          )}
          {geometry ? (
            <Grid
              align="stretch"
              as="dl"
              gap={0}
              columns={1}
              minColumnWidth="0px"
              className="image-operation-geometry [&_>_div]:flex [&_>_div]:justify-between [&_>_div]:gap-[10px] [&_dt]:text-muted [&_dd]:m-0 [&_dd]:tabular-nums grid gap-space-1 m-0 text-caption"
            >
              <div>
                <dt>{t("inputs.input")}</dt>
                <dd>
                  {geometry.input_size.width} × {geometry.input_size.height}
                </dd>
              </div>
              <div>
                <dt>{t("inputs.output")}</dt>
                <dd>
                  {geometry.output_size.width} × {geometry.output_size.height}
                </dd>
              </div>
              <div>
                <dt>{t("inputs.pricing")}</dt>
                <dd>
                  {geometry.pricing_size.width} × {geometry.pricing_size.height}
                </dd>
              </div>
            </Grid>
          ) : (
            <p className="image-operation-note text-muted text-caption leading-[1.6]">
              {estimate &&
              effectiveOperation?.kind === "imageToImage" &&
              !effectiveOperation.maxEnhance
                ? t("inputs.maxEnhanceInactive")
                : t("inputs.awaitingGeometry")}
            </p>
          )}
        </>
      )}
      <Grid align="stretch" columns={2} minColumnWidth="110px" gap={3}>
        {(["strength", "noise"] as const).map((field) => {
          const range =
            capabilities?.ranges[field === "strength" ? "img2imgStrength" : "img2imgNoise"];
          const label = field === "strength" ? t("inputs.strength") : t("inputs.noise");
          return (
            <div key={field} data-setting-field={field}>
              <Field label={label} htmlFor={`${prefix}-${field}`} feedback={messages(field)}>
                <NumberSlider
                  id={`${prefix}-${field}`}
                  label={label}
                  value={operation[field]}
                  range={range}
                  sliderRange={range}
                  invalid={rejected(field)}
                  describedBy={controlProps(field)["aria-describedby"]}
                  onChange={(value) => numeric(field, String(value))}
                />
              </Field>
            </div>
          );
        })}
      </Grid>
      <ImageToImageAdvancedSettings
        operation={operation}
        feedback={feedback}
        updateOperation={updateOperation}
      />
    </Grid>
  );
}
