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
  const { messages, controlProps } = feedback;
  return (
    <div className="image-operation-fields">
      <div data-setting-field="upscaleModel">
        <Field label="放大模型">
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
              <option value={operation.model}>{operation.model} · 已保存</option>
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
        <Field label="Blur Sigma">
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
                {operation.declaredBlurSigma} · 已保存
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
            重试
          </Button>
        </div>
      )}
      {!options && !optionsError && <output className="muted">正在读取放大选项…</output>}
    </div>
  );
}
