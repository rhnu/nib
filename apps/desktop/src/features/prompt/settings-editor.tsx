import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowLeftRight, RotateCcw } from "lucide-react";
import type { GenerationSettings, ModelCapabilities, ResolvedSettings } from "@/bindings/workbench";
import type { ParameterDiagnostic } from "@/bindings/generation";
import { FormField, FormGrid, HelpMarker, IconButton } from "@/shared/ui";
import {
  advancedSettingKeys,
  diagnosticSetting,
  settingLabels,
  settingValue,
  type SettingKey,
} from "./settings";

export { focusSetting } from "./settings";

export interface SettingsEditorProps {
  value: GenerationSettings;
  onChange: (value: GenerationSettings) => void;
  models: string[];
  resolved?: ResolvedSettings;
  capabilities?: ModelCapabilities | null;
  diagnostics?: ParameterDiagnostic[];
  errorFields?: string[];
  fields?: "all" | "model" | "modelOnly" | "prompt" | "promptOptions" | "image" | "parameters";
  mode?: "draft" | "preset" | "instance";
  advancedContent?: ReactNode;
}

/** Shared sparse settings preserve inheritance and explicit false and zero values. */
export function SettingsEditor({
  value,
  onChange,
  models,
  resolved,
  capabilities,
  diagnostics = [],
  errorFields = [],
  fields = "all",
  mode = "draft",
  advancedContent,
}: SettingsEditorProps) {
  const prefix = useId();
  const advanced = useRef<HTMLDetailsElement>(null);
  const effective = resolved ?? capabilities?.defaults;
  const [customSize, setCustomSize] = useState(false);
  const sizePreset = capabilities?.sizePresets.find(
    (preset) => preset.width === value.size?.width && preset.height === value.size?.height,
  );
  const diagnosticSignature = diagnostics
    .map(({ field, change }) => `${field}:${change}`)
    .join("|");
  const errorSignature = errorFields.join("|");
  const hasAdvancedDiagnostic = [...diagnostics.map((item) => item.field), ...errorFields].some(
    (field) => {
      const key = diagnosticSetting(field);
      return (
        (key !== null && advancedSettingKeys.includes(key)) ||
        field.split(".").some((part) => part === "policy" || part === "stream")
      );
    },
  );
  useEffect(() => {
    if (advanced.current && hasAdvancedDiagnostic) advanced.current.open = true;
  }, [diagnosticSignature, errorSignature, hasAdvancedDiagnostic]);

  const change = <K extends SettingKey>(key: K, next: GenerationSettings[K]) =>
    onChange({ ...value, [key]: next });

  const inherited = (key: SettingKey) =>
    `${effective ? settingValue(key, effective[key]) : "默认"} · 继承`;

  const diagnosticsFor = (key: SettingKey) =>
    diagnostics.filter((item) => diagnosticSetting(item.field) === key);

  const wrapper = (key: SettingKey, control: ReactNode, help?: string, unsupported = false) => {
    const messages = diagnosticsFor(key);
    const rejected = errorFields.some((field) => diagnosticSetting(field) === key);
    return (
      <div
        className={`setting-field ${messages.length || rejected ? "setting-diagnostic" : ""}`}
        data-setting-field={key}
        key={key}
      >
        <FormField
          label={settingLabels[key]}
          htmlFor={`${prefix}-${key}`}
          inherited={value[key] === null}
          className={key === "model" && fields === "modelOnly" ? "model-form-field" : ""}
          help={help && <HelpMarker label={`${settingLabels[key]}说明`}>{help}</HelpMarker>}
          actions={
            value[key] !== null && (
              <IconButton label={`恢复继承${settingLabels[key]}`} onClick={() => change(key, null)}>
                <RotateCcw size={12} />
              </IconButton>
            )
          }
        >
          {control}
        </FormField>
        {unsupported && <small className="setting-note">当前模型不支持，已保留设置。</small>}
        {messages.length > 0 && (
          <output id={`${prefix}-${key}-diagnostic`} className="setting-message">
            {messages.map((item, index) => (
              <p key={index}>{item.change}</p>
            ))}
          </output>
        )}
        {rejected && <small className="setting-message">此项无效，详见生成区错误。</small>}
      </div>
    );
  };

  const controlProps = (key: SettingKey) => ({
    id: `${prefix}-${key}`,
    "aria-describedby": diagnosticsFor(key).length ? `${prefix}-${key}-diagnostic` : undefined,
    "aria-invalid": errorFields.some((field) => diagnosticSetting(field) === key) || undefined,
  });

  const number = (key: "steps" | "scale" | "seed" | "nSamples" | "cfgRescale", help?: string) => {
    const range = key === "seed" ? undefined : capabilities?.ranges[key];
    const numericInput = (
      <input
        {...controlProps(key)}
        type="number"
        step={key === "scale" || key === "cfgRescale" ? "any" : 1}
        min={range?.min}
        max={range?.max}
        value={value[key] ?? ""}
        placeholder={inherited(key)}
        onChange={(event) => {
          if (event.target.value === "") change(key, null);
          else if (Number.isFinite(event.target.valueAsNumber))
            change(key, event.target.valueAsNumber);
        }}
      />
    );
    const sliderValue = value[key] ?? effective?.[key];
    const hasSlider = (key === "steps" || key === "scale") && range && sliderValue !== undefined;
    return wrapper(
      key,
      hasSlider ? (
        <div className="setting-slider">
          <input
            type="range"
            aria-label={`${settingLabels[key]}滑块`}
            aria-invalid={controlProps(key)["aria-invalid"]}
            aria-describedby={controlProps(key)["aria-describedby"]}
            min={range.min}
            max={range.max}
            step={key === "steps" ? 1 : "any"}
            value={Math.max(range.min, Math.min(range.max, sliderValue))}
            disabled={range.min === range.max}
            onChange={(event) => change(key, event.currentTarget.valueAsNumber)}
          />
          {numericInput}
        </div>
      ) : (
        numericInput
      ),
      range && range.min === range.max
        ? `${help ? `${help} ` : ""}当前模型固定为 ${range.min}，已保留设置。`
        : help,
    );
  };

  const options = <
    K extends
      | "model"
      | "quality"
      | "ucPreset"
      | "sampler"
      | "noiseSchedule"
      | "imageFormat"
      | "alphaMode"
      | "responseFormat",
  >(
    key: K,
    choices: readonly NonNullable<GenerationSettings[K]>[] | undefined,
    help?: string,
    fixed?: string | null,
  ) => {
    const current = value[key];
    const hasCurrent = current !== null && choices?.includes(current);
    return wrapper(
      key,
      <select
        {...controlProps(key)}
        value={current ?? ""}
        onChange={(event) => change(key, (event.target.value || null) as GenerationSettings[K])}
      >
        <option value="">{inherited(key)}</option>
        {current !== null && !hasCurrent && <option value={current}>{current} · 已保存</option>}
        {choices?.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>,
      fixed ? `${help ? `${help} ` : ""}当前模型固定为 ${fixed}；切换模型不会清除已有覆盖。` : help,
      current !== null && choices !== undefined && !hasCurrent,
    );
  };

  const boolean = (
    key:
      | "furryMode"
      | "legacyUc"
      | "transparentBackground"
      | "varietyBoost"
      | "decrisp"
      | "smea"
      | "smeaDyn",
    supported?: boolean,
    help?: string,
  ) =>
    wrapper(
      key,
      <select
        {...controlProps(key)}
        value={value[key] === null ? "" : String(value[key])}
        onChange={(event) =>
          change(key, event.target.value === "" ? null : event.target.value === "true")
        }
      >
        <option value="">{inherited(key)}</option>
        <option value="true" disabled={supported === false}>
          开启
        </option>
        <option value="false">关闭</option>
      </select>,
      help,
      supported === false && value[key] === true,
    );

  const advancedCount = advancedSettingKeys.filter((key) => value[key] !== null).length;
  const advancedSummary = advancedCount ? `${advancedCount} 项已设置` : "";
  return (
    <div className="settings-editor" data-setting-editor={mode}>
      {(fields === "all" || fields === "model" || fields === "modelOnly") && (
        <FormGrid className="settings-fields settings-model">
          {options("model", models)}
          {fields !== "modelOnly" && boolean("furryMode", capabilities?.furryMode)}
        </FormGrid>
      )}
      {(fields === "all" || fields === "prompt" || fields === "promptOptions") && (
        <FormGrid className="settings-fields settings-prompt">
          {options(
            "quality",
            capabilities?.qualityPresets,
            "自动追加模型质量标签；字面提示词保持原样。",
          )}
          {options("ucPreset", capabilities?.ucPresets, "与自定义负面提示一起组成实际提交文本。")}
          {fields === "promptOptions" && boolean("furryMode", capabilities?.furryMode)}
          {(capabilities?.transparentBackground || value.transparentBackground !== null) &&
            boolean(
              "transparentBackground",
              capabilities?.transparentBackground,
              "请求透明背景；适用于 V5。",
            )}
        </FormGrid>
      )}
      {(fields === "all" || fields === "image") && (
        <FormGrid className="settings-fields settings-image">
          {wrapper(
            "size",
            <div className="size-editor">
              <select
                aria-label="尺寸预设"
                value={
                  value.size === null ? "" : customSize ? "custom" : (sizePreset?.id ?? "custom")
                }
                onChange={(event) => {
                  const selected = event.target.value;
                  setCustomSize(selected === "custom");
                  if (!selected) change("size", null);
                  else if (selected === "custom") {
                    if (!value.size && effective) change("size", effective.size);
                  } else {
                    const preset = capabilities?.sizePresets.find(
                      (preset) => preset.id === selected,
                    );
                    if (preset) change("size", { width: preset.width, height: preset.height });
                  }
                }}
              >
                <option value="">{inherited("size")}</option>
                {capabilities?.sizePresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label} · {preset.width} × {preset.height}
                  </option>
                ))}
                <option value="custom">Custom · 自定义</option>
              </select>
              <div className="size-inputs">
                <input
                  {...controlProps("size")}
                  aria-label="宽度"
                  type="number"
                  min={capabilities?.ranges.dimension.min}
                  max={capabilities?.ranges.dimension.max}
                  step={capabilities?.ranges.dimensionMultiple}
                  value={value.size?.width ?? ""}
                  placeholder={effective ? String(effective.size.width) : "继承宽度"}
                  onChange={(event) => {
                    if (event.target.value !== "" && !Number.isFinite(event.target.valueAsNumber))
                      return;
                    setCustomSize(true);
                    change(
                      "size",
                      event.target.value === ""
                        ? null
                        : {
                            width: event.target.valueAsNumber,
                            height:
                              value.size?.height ??
                              effective?.size.height ??
                              event.target.valueAsNumber,
                          },
                    );
                  }}
                />
                <span>×</span>
                <input
                  aria-label="高度"
                  type="number"
                  min={capabilities?.ranges.dimension.min}
                  max={capabilities?.ranges.dimension.max}
                  step={capabilities?.ranges.dimensionMultiple}
                  value={value.size?.height ?? ""}
                  placeholder={effective ? String(effective.size.height) : "继承高度"}
                  aria-describedby={
                    diagnosticsFor("size").length ? `${prefix}-size-diagnostic` : undefined
                  }
                  onChange={(event) => {
                    if (event.target.value !== "" && !Number.isFinite(event.target.valueAsNumber))
                      return;
                    setCustomSize(true);
                    change(
                      "size",
                      event.target.value === ""
                        ? null
                        : {
                            height: event.target.valueAsNumber,
                            width:
                              value.size?.width ??
                              effective?.size.width ??
                              event.target.valueAsNumber,
                          },
                    );
                  }}
                />
                <IconButton
                  label="交换宽高"
                  disabled={!value.size && !effective}
                  onClick={() => {
                    const size = value.size ?? effective?.size;
                    if (size) change("size", { width: size.height, height: size.width });
                  }}
                >
                  <ArrowLeftRight size={13} />
                </IconButton>
              </div>
            </div>,
            capabilities
              ? `尺寸步进 ${capabilities.ranges.dimensionMultiple}；最大像素 ${capabilities.ranges.maxPixels.toLocaleString()}。`
              : undefined,
          )}
          {capabilities
            ? wrapper(
                "nSamples",
                <fieldset className="sample-options" aria-label="样本数">
                  <button
                    id={`${prefix}-nSamples`}
                    type="button"
                    className="sample-inherit"
                    title={inherited("nSamples")}
                    aria-pressed={value.nSamples === null}
                    onClick={() => change("nSamples", null)}
                  >
                    继承
                  </button>
                  {Array.from(
                    {
                      length: Math.max(
                        0,
                        Math.floor(capabilities.ranges.nSamples.max) -
                          Math.ceil(capabilities.ranges.nSamples.min) +
                          1,
                      ),
                    },
                    (_, index) => Math.ceil(capabilities.ranges.nSamples.min) + index,
                  ).map((count) => (
                    <button
                      type="button"
                      key={count}
                      aria-pressed={value.nSamples === count}
                      onClick={() => change("nSamples", count)}
                    >
                      {count}
                    </button>
                  ))}
                  {value.nSamples !== null &&
                    (value.nSamples < capabilities.ranges.nSamples.min ||
                      value.nSamples > capabilities.ranges.nSamples.max) && (
                      <output className="sample-saved">{value.nSamples} · 已保存</output>
                    )}
                </fieldset>,
                "一次生成的图片数量，上限随尺寸变化。",
              )
            : number("nSamples", "一次生成的图片数量，上限随尺寸变化。")}
        </FormGrid>
      )}
      {(fields === "all" || fields === "parameters") && (
        <>
          <FormGrid className="settings-fields settings-main">
            {number("steps")}
            {number("scale")}
            {number("seed", "输入 0 使用随机种子；固定种子便于复现。")}
            {options("sampler", capabilities?.samplers, undefined, capabilities?.fixedSampler)}
          </FormGrid>
          <details className="advanced-settings" ref={advanced}>
            <summary>
              <span>高级设置</span>
              {advancedSummary && <small>{advancedSummary}</small>}
            </summary>
            <FormGrid className="settings-fields">
              {options(
                "noiseSchedule",
                capabilities?.noiseSchedules,
                undefined,
                capabilities?.fixedNoiseSchedule,
              )}
              {number("cfgRescale")}
              {boolean("varietyBoost", capabilities?.varietyBoost)}
              {boolean("decrisp", capabilities?.decrisp)}
              {boolean("smea", capabilities?.smea)}
              {boolean("smeaDyn", capabilities?.smea)}
              {boolean("legacyUc", capabilities?.legacyUc)}
              <h4 className="settings-group-title">输出</h4>
              {options("alphaMode", capabilities?.alphaModes)}
              {options("imageFormat", capabilities?.imageFormats)}
              {options(
                "responseFormat",
                capabilities?.responseFormats,
                "选择 ZIP 或 JSON 图像响应。",
              )}
              {advancedContent && <h4 className="settings-group-title">执行</h4>}
              {advancedContent}
            </FormGrid>
          </details>
        </>
      )}
    </div>
  );
}
