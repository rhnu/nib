import { t, useTranslation } from "@/shared/i18n";
import type { GenerationQuote } from "@/bindings/generation";
import type { CreationOperation, ModelCapabilities } from "@/bindings/workbench";
import { FormField, FormGrid, NumberSlider } from "@/shared/ui";
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
    <div className="image-operation-fields">
      {operation.maxEnhance && (
        <>
          {capabilities?.maxEnhance === false && (
            <p className="inline-warning" role="alert">
              {t("inputs.maxEnhanceUnsupported")}
            </p>
          )}
          {geometry ? (
            <dl className="image-operation-geometry">
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
            </dl>
          ) : (
            <p className="image-operation-note">
              {estimate &&
              effectiveOperation?.kind === "imageToImage" &&
              !effectiveOperation.maxEnhance
                ? t("inputs.maxEnhanceInactive")
                : t("inputs.awaitingGeometry")}
            </p>
          )}
        </>
      )}
      <FormGrid>
        {(["strength", "noise"] as const).map((field) => {
          const range =
            capabilities?.ranges[field === "strength" ? "img2imgStrength" : "img2imgNoise"];
          const label = field === "strength" ? t("inputs.strength") : t("inputs.noise");
          return (
            <div key={field} data-setting-field={field}>
              <FormField label={label} htmlFor={`${prefix}-${field}`} feedback={messages(field)}>
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
              </FormField>
            </div>
          );
        })}
      </FormGrid>
      <ImageToImageAdvancedSettings
        operation={operation}
        feedback={feedback}
        updateOperation={updateOperation}
      />
    </div>
  );
}
