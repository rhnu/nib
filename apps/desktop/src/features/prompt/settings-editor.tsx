import { t, useTranslation, formatNumber } from "@/shared/i18n";
import { errorMessage } from "@/shared/host/error";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowLeftRight, RotateCcw } from "lucide-react";
import type { GenerationSettings, ModelCapabilities, ResolvedSettings } from "@/bindings/workbench";
import type { ParameterDiagnostic } from "@/bindings/generation";
import {
  FormField,
  FormGrid,
  HelpMarker,
  IconButton,
  Select,
  type SelectOption,
} from "@/shared/ui";
import {
  advancedSettingKeys,
  diagnosticSetting,
  settingLabels,
  settingValue,
  type SettingKey,
} from "./settings";

export { focusSetting } from "./settings";

const sizePresetLabels: Record<string, () => string> = {
  portrait: () => t("presets.portrait"),
  landscape: () => t("presets.landscape"),
  square: () => t("presets.square"),
  largePortrait: () => t("presets.portrait"),
  largeLandscape: () => t("presets.landscape"),
};

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
  useTranslation();

  const prefix = useId();
  const advanced = useRef<HTMLDetailsElement>(null);
  const effective = resolved ?? capabilities?.defaults;
  const [customSize, setCustomSize] = useState(false);
  const sizePreset = capabilities?.sizePresets.find(
    (preset) => preset.width === value.size?.width && preset.height === value.size?.height,
  );
  const diagnosticSignature = JSON.stringify(diagnostics);
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
    t("prompt.inheritedValue", {
      value0: effective ? settingValue(key, effective[key]) : t("prompt.default"),
    });

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
          help={
            help && (
              <HelpMarker label={t("prompt.settingHelp", { value0: settingLabels[key] })}>
                {help}
              </HelpMarker>
            )
          }
          actions={
            value[key] !== null && (
              <IconButton
                label={t("prompt.restoreInheritance", { value0: settingLabels[key] })}
                onClick={() => change(key, null)}
              >
                <RotateCcw size={12} />
              </IconButton>
            )
          }
        >
          {control}
        </FormField>
        {unsupported && (
          <small className="setting-note">{t("prompt.unsupportedSettingKept")}</small>
        )}
        {messages.length > 0 && (
          <output id={`${prefix}-${key}-diagnostic`} className="setting-message">
            {messages.map((item, index) => (
              <p key={index}>{errorMessage(item.change)}</p>
            ))}
          </output>
        )}
        {rejected && <small className="setting-message">{t("prompt.invalidSetting")}</small>}
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
            aria-label={t("prompt.settingSlider", { value0: settingLabels[key] })}
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
        ? t("prompt.fixedValueKept", { value0: help ? `${help} ` : "", value1: range.min })
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
      <Select
        {...controlProps(key)}
        value={current ?? ""}
        onValueChange={(next) => change(key, (next || null) as GenerationSettings[K])}
        options={[
          { value: "", label: inherited(key) },
          ...(current !== null && !hasCurrent
            ? [{ value: current, label: `${settingValue(key, current)}${t("prompt.savedTag")}` }]
            : []),
          ...(choices?.map((option) => ({ value: option, label: settingValue(key, option) })) ??
            []),
        ]}
      />,
      fixed
        ? t("prompt.fixedValueOverrideKept", {
            value0: help ? `${help} ` : "",
            value1: settingValue(key, fixed),
          })
        : help,
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
      <Select
        {...controlProps(key)}
        value={value[key] === null ? "" : String(value[key])}
        onValueChange={(next) => change(key, next === "" ? null : next === "true")}
        options={[
          { value: "", label: inherited(key) },
          { value: "true", label: t("prompt.on"), disabled: supported === false },
          { value: "false", label: t("prompt.off") },
        ]}
      />,
      help,
      supported === false && value[key] === true,
    );

  const advancedCount = advancedSettingKeys.filter((key) => value[key] !== null).length;
  const advancedSummary = advancedCount
    ? t("prompt.configuredCount", { count: advancedCount })
    : "";
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
          {options("quality", capabilities?.qualityPresets, t("prompt.qualityTagsHelp"))}
          {options("ucPreset", capabilities?.ucPresets, t("prompt.negativePresetHelp"))}
          {fields === "promptOptions" && boolean("furryMode", capabilities?.furryMode)}
          {(capabilities?.transparentBackground || value.transparentBackground !== null) &&
            boolean(
              "transparentBackground",
              capabilities?.transparentBackground,
              t("prompt.transparentBackgroundHelp"),
            )}
        </FormGrid>
      )}
      {(fields === "all" || fields === "image") && (
        <FormGrid className="settings-fields settings-image">
          {wrapper(
            "size",
            <div className="size-editor">
              <Select
                aria-label={t("prompt.sizePreset")}
                aria-invalid={controlProps("size")["aria-invalid"]}
                aria-describedby={controlProps("size")["aria-describedby"]}
                value={
                  value.size === null ? "" : customSize ? "custom" : (sizePreset?.id ?? "custom")
                }
                onValueChange={(selected) => {
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
                options={[
                  { value: "", label: inherited("size") },
                  ...(capabilities?.sizePresets.map((preset): SelectOption => ({
                    value: preset.id,
                    label: `${sizePresetLabels[preset.id]?.() ?? preset.id} (${preset.width}×${preset.height})`,
                    group: preset.id.startsWith("large")
                      ? t("prompt.largeSizes")
                      : t("prompt.standardSizes"),
                  })) ?? []),
                  { value: "custom", label: t("prompt.custom") },
                ]}
              />
              <div className="size-inputs">
                <input
                  {...controlProps("size")}
                  aria-label={t("prompt.width")}
                  type="number"
                  min={capabilities?.ranges.dimension.min}
                  max={capabilities?.ranges.dimension.max}
                  step={capabilities?.ranges.dimensionMultiple}
                  value={value.size?.width ?? ""}
                  placeholder={effective ? String(effective.size.width) : t("prompt.inheritWidth")}
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
                  aria-label={t("prompt.height")}
                  type="number"
                  min={capabilities?.ranges.dimension.min}
                  max={capabilities?.ranges.dimension.max}
                  step={capabilities?.ranges.dimensionMultiple}
                  value={value.size?.height ?? ""}
                  placeholder={
                    effective ? String(effective.size.height) : t("prompt.inheritHeight")
                  }
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
                  label={t("prompt.swapDimensions")}
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
              ? t("prompt.dimensionLimits", {
                  value0: capabilities.ranges.dimensionMultiple,
                  value1: formatNumber(capabilities.ranges.maxPixels),
                })
              : undefined,
          )}
          {capabilities
            ? wrapper(
                "nSamples",
                <fieldset className="sample-options" aria-label={t("prompt.samples")}>
                  <button
                    id={`${prefix}-nSamples`}
                    type="button"
                    className="sample-inherit"
                    title={inherited("nSamples")}
                    aria-pressed={value.nSamples === null}
                    onClick={() => change("nSamples", null)}
                  >
                    {t("prompt.inherit")}
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
                      <output className="sample-saved">
                        {value.nSamples}
                        {t("prompt.savedTag")}
                      </output>
                    )}
                </fieldset>,
                t("prompt.samplesHelp"),
              )
            : number("nSamples", t("prompt.samplesHelp"))}
        </FormGrid>
      )}
      {(fields === "all" || fields === "parameters") && (
        <>
          <FormGrid className="settings-fields settings-main">
            {number("steps")}
            {number("scale")}
            {number("seed", t("prompt.seedHelp"))}
            {options("sampler", capabilities?.samplers, undefined, capabilities?.fixedSampler)}
          </FormGrid>
          <details className="advanced-settings" ref={advanced}>
            <summary>
              <span>{t("prompt.advancedSettings")}</span>
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
              <h4 className="settings-group-title">{t("prompt.output")}</h4>
              {options("alphaMode", capabilities?.alphaModes)}
              {options("imageFormat", capabilities?.imageFormats)}
              {options(
                "responseFormat",
                capabilities?.responseFormats,
                t("prompt.responseFormatHelp"),
              )}
              {advancedContent && <h4 className="settings-group-title">{t("prompt.execution")}</h4>}
              {advancedContent}
            </FormGrid>
          </details>
        </>
      )}
    </div>
  );
}
