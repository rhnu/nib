import { useId, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { X } from "lucide-react";
import type { ParameterDiagnostic } from "../../bindings/generation";
import type {
  CreationOperation,
  ImageOperationOptions,
  ModelCapabilities,
} from "../../bindings/workbench";
import {
  Button,
  Field,
  FormField,
  FormGrid,
  NumberSlider,
  HelpMarker,
  Modal,
  Toggle,
} from "../../shared/ui";
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
          <FormGrid>
            {(["strength", "noise"] as const).map((field) => {
              const range =
                capabilities?.ranges[field === "strength" ? "inpaintStrength" : "img2imgNoise"];
              const label = field === "strength" ? "Strength" : "Noise";
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
              <Popover.Title>局部重绘高级设置</Popover.Title>
              <Popover.Close className="icon-button" aria-label="关闭局部重绘高级设置">
                <X size={14} />
              </Popover.Close>
            </header>
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
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
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
