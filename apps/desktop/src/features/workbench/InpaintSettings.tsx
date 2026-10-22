import { useEffect, useId, useRef, useState } from "react";
import type { ParameterDiagnostic } from "../../bindings/generation";
import type {
  CreationOperation,
  ImageOperationOptions,
  ModelCapabilities,
} from "../../bindings/workbench";
import { Button, Field, HelpMarker, Modal, Toggle } from "../../shared/ui";
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
  const prefix = useId();
  const advanced = useRef<HTMLDetailsElement>(null);
  const [confirmPure, setConfirmPure] = useState(false);
  const normalize = (field: string) => field.replaceAll("_", "").toLowerCase().split(".").at(-1);
  const diagnostic = (field: string) =>
    diagnostics.filter((item) => normalize(item.field) === field.toLowerCase());
  const rejected = (field: string) =>
    errorFields.some((item) => normalize(item) === field.toLowerCase());
  const signature = [
    ...diagnostics.map((item) => `${item.field}:${item.change}`),
    ...errorFields,
  ].join("|");
  const advancedIssue = [...diagnostics.map((item) => item.field), ...errorFields].some((field) =>
    ["colorcorrect", "extranoiseseed", "addoriginalimage"].includes(normalize(field) ?? ""),
  );
  useEffect(() => {
    if (advanced.current && advancedIssue) advanced.current.open = true;
  }, [advancedIssue, signature]);
  const props = (field: string) => ({
    "aria-invalid": rejected(field) || undefined,
    "aria-describedby":
      diagnostic(field).length || rejected(field) ? `${prefix}-${field}` : undefined,
  });
  const messages = (field: string) =>
    diagnostic(field).length || rejected(field) ? (
      <output className="image-operation-diagnostic" id={`${prefix}-${field}`}>
        {diagnostic(field).map((item, index) => (
          <span key={index}>{item.change}</span>
        ))}
        {rejected(field) && <span>SDK 拒绝该字段，请查看生成区错误并调整。</span>}
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
          当前模型不支持局部重绘，请更换模型。
        </p>
      )}
      {conditioning && capabilities?.inpaintingImageToImage === false && (
        <p className="inline-warning" role="alert">
          当前模型不支持局部图生图条件。请选择纯补绘或更换模型。
        </p>
      )}
      <div data-setting-field="img2img">
        <div className="setting-label">
          <span>局部条件</span>
          <HelpMarker label="局部条件说明">
            纯补绘重新生成遮罩区域；局部图生图使用遮罩内的源图内容，并提供强度与噪声设置。模型能力由
            SDK 决定。
          </HelpMarker>
        </div>
        <select
          aria-label="局部条件"
          {...props("img2img")}
          value={conditioning ? "conditioned" : "pure"}
          onChange={(event) => {
            if (event.target.value === "pure") setConfirmPure(true);
            else if (defaults) update((current) => ({ ...current, img2img: { ...defaults } }));
          }}
        >
          <option value="pure">纯补绘</option>
          <option
            value="conditioned"
            disabled={
              capabilities?.inpaintingImageToImage === false || (!defaults && !conditioning)
            }
          >
            局部图生图
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
              重试
            </Button>
          </div>
        ) : (
          <output className="muted">正在读取局部条件选项…</output>
        ))}
      {conditioning && (
        <>
          <div data-setting-field="strength">
            <Field label="Strength">
              <input
                {...props("strength")}
                type="number"
                step="any"
                value={conditioning.strength}
                min={capabilities?.ranges.inpaintStrength.min}
                max={capabilities?.ranges.inpaintStrength.max}
                onChange={(event) => numeric("strength", event.target.value)}
              />
            </Field>
            {messages("strength")}
          </div>
          <div data-setting-field="noise">
            <Field label="Noise">
              <input
                {...props("noise")}
                type="number"
                step="any"
                value={conditioning.noise}
                min={capabilities?.ranges.img2imgNoise.min}
                max={capabilities?.ranges.img2imgNoise.max}
                onChange={(event) => numeric("noise", event.target.value)}
              />
            </Field>
            {messages("noise")}
          </div>
        </>
      )}
      <details className="image-operation-advanced" ref={advanced}>
        <summary>
          局部重绘高级设置
          <small>
            保留原图{operation.addOriginalImage ? "开" : "关"}
            {conditioning
              ? ` · 颜色校正${conditioning.color_correct ? "开" : "关"} · 噪声种子${conditioning.extra_noise_seed ?? "继承"}`
              : ""}
          </small>
        </summary>
        <div className="image-operation-fields">
          {conditioning && (
            <>
              <fieldset
                className="image-operation-toggle"
                data-setting-field="colorCorrect"
                aria-label="Color Correct"
                {...props("colorCorrect")}
              >
                <span>Color Correct</span>
                <Toggle
                  label="Color Correct"
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
                <Field label="额外噪声种子">
                  <input
                    {...props("extraNoiseSeed")}
                    type="number"
                    step={1}
                    placeholder="留空继承生成种子"
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
            aria-label="保留遮罩外原图"
            {...props("addOriginalImage")}
          >
            <span>保留遮罩外原图</span>
            <Toggle
              label="保留遮罩外原图"
              checked={operation.addOriginalImage}
              onChange={(addOriginalImage) =>
                update((current) => ({ ...current, addOriginalImage }))
              }
            />
            {messages("addOriginalImage")}
          </fieldset>
        </div>
      </details>
      <Modal open={confirmPure} onClose={() => setConfirmPure(false)} title="改为纯补绘？">
        <p className="confirm-copy">将清除当前局部图生图的强度、噪声、颜色校正和噪声种子。</p>
        <div className="dialog-actions">
          <Button onClick={() => setConfirmPure(false)}>取消</Button>
          <Button
            className="primary"
            onClick={() => {
              update((current) => ({ ...current, img2img: null }));
              setConfirmPure(false);
            }}
          >
            使用纯补绘
          </Button>
        </div>
      </Modal>
    </div>
  );
}
