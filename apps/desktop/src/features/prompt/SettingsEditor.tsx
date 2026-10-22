import { useEffect, useId, useRef, type ReactNode } from "react";
import { ArrowLeftRight, RotateCcw } from "lucide-react";
import type {
  GenerationSettings,
  ModelCapabilities,
  ResolvedSettings,
} from "../../bindings/workbench";
import type { ParameterDiagnostic } from "../../bindings/generation";
import { HelpMarker, IconButton } from "../../shared/ui";
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
  fields?: "all" | "model" | "prompt" | "image" | "parameters";
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
  const diagnosticSignature = diagnostics
    .map(({ field, change }) => `${field}:${change}`)
    .join("|");
  const errorSignature = errorFields.join("|");
  const hasAdvancedDiagnostic = [...diagnostics.map((item) => item.field), ...errorFields].some(
    (field) => {
      const key = diagnosticSetting(field);
      return (
        (key !== null && advancedSettingKeys.includes(key)) || field.split(".").includes("policy")
      );
    },
  );
  useEffect(() => {
    if (advanced.current && hasAdvancedDiagnostic) advanced.current.open = true;
  }, [diagnosticSignature, errorSignature, hasAdvancedDiagnostic]);

  const change = <K extends SettingKey>(key: K, next: GenerationSettings[K]) =>
    onChange({ ...value, [key]: next });
  const inherited = (key: SettingKey) =>
    `继承${effective ? ` · ${settingValue(key, effective[key])}` : ""}`;
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
        <div className="setting-label">
          <label htmlFor={`${prefix}-${key}`}>{settingLabels[key]}</label>
          {help && <HelpMarker label={`${settingLabels[key]}说明`}>{help}</HelpMarker>}
          <span className="spacer" />
          {value[key] !== null && (
            <IconButton label={`恢复继承${settingLabels[key]}`} onClick={() => change(key, null)}>
              <RotateCcw size={12} />
            </IconButton>
          )}
        </div>
        {control}
        {unsupported && (
          <small className="setting-note">当前模型不支持；已有值保留，由 SDK 校验。</small>
        )}
        {messages.length > 0 && (
          <output id={`${prefix}-${key}-diagnostic`} className="setting-message">
            {messages.map((item, index) => (
              <p key={index}>{item.change}</p>
            ))}
          </output>
        )}
        {rejected && (
          <small className="setting-message">此项未通过 SDK 校验，详见生成区错误。</small>
        )}
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
    return wrapper(
      key,
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
      />,
      range && range.min === range.max
        ? `${help ? `${help} ` : ""}当前模型固定为 ${range.min}；已有覆盖保留，由 SDK 校验。`
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

  const advancedValues = advancedSettingKeys
    .filter((key) => value[key] !== null)
    .map((key) => `${settingLabels[key]} ${settingValue(key, value[key])}`);
  const advancedSummary = advancedValues.length
    ? `${advancedValues.length} 项覆盖 · ${advancedValues.join(" · ")}`
    : "继承配方或 SDK 默认";
  return (
    <div className="settings-editor" data-setting-editor={mode}>
      {(fields === "all" || fields === "model") && (
        <div className="settings-fields settings-model">
          {options("model", models)}
          {boolean("furryMode", capabilities?.furryMode, "使用模型提供的 Furry 数据集标签。")}
        </div>
      )}
      {(fields === "all" || fields === "prompt") && (
        <div className="settings-fields settings-prompt">
          {options(
            "quality",
            capabilities?.qualityPresets,
            "自动追加模型质量标签；字面提示词保持原样。",
          )}
          {options("ucPreset", capabilities?.ucPresets, "与自定义负面提示一起组成实际提交文本。")}
        </div>
      )}
      {(fields === "all" || fields === "image") && (
        <div className="settings-fields settings-image">
          {wrapper(
            "size",
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
            </div>,
            capabilities
              ? `尺寸步进 ${capabilities.ranges.dimensionMultiple}；最大像素 ${capabilities.ranges.maxPixels.toLocaleString()}。实际限制由 SDK 校验。`
              : undefined,
          )}
          {number("nSamples", "一次请求生成的图片数量；可用上限随尺寸变化，由 SDK 校验。")}
        </div>
      )}
      {(fields === "all" || fields === "parameters") && (
        <>
          <div className="settings-fields settings-main">
            {number("steps")}
            {number("scale")}
            {number(
              "seed",
              "留空继承；显式输入 0 使用自动种子。指定非零种子时保存该值。提交时由 SDK 确定实际种子。",
            )}
            {options("sampler", capabilities?.samplers, undefined, capabilities?.fixedSampler)}
          </div>
          <details className="advanced-settings" ref={advanced}>
            <summary>
              <span>高级设置</span>
              <small>{advancedSummary}</small>
            </summary>
            <div className="settings-fields">
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
              {boolean(
                "transparentBackground",
                capabilities?.transparentBackground,
                "模型提示层面的透明背景请求，与文件的 Alpha 表示分别设置。",
              )}
              {options("alphaMode", capabilities?.alphaModes)}
              {options("imageFormat", capabilities?.imageFormats)}
              {options(
                "responseFormat",
                capabilities?.responseFormats,
                "选择 SDK 的 ZIP 或 JSON 图像响应。",
              )}
              {advancedContent}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
