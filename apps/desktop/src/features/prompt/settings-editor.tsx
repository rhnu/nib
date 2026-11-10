import {
  HelpMarker,
  IconButton,
  Select,
  type SelectOption,
  Grid,
  Field,
  Row,
  Input,
  Button,
  InputRow,
} from "@/shared/ui";

import { t, useTranslation, formatNumber } from "@/shared/i18n";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowLeftRight, LockKeyhole, RotateCcw } from "lucide-react";
import type { GenerationSettings, ModelCapabilities, ResolvedSettings } from "@/bindings/workbench";
import type { ParameterDiagnostic } from "@/bindings/generation";

import {
  advancedSettingKeys,
  diagnosticSetting,
  settingDiagnosticMessage,
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

  const wrapper = (
    key: SettingKey,
    control: ReactNode,
    help?: string,
    lockReason?: string,
    unsupported = false,
  ) => {
    const messages = diagnosticsFor(key);
    const rejected = errorFields.some((field) => diagnosticSetting(field) === key);
    return (
      <Field
        label={settingLabels[key]}
        htmlFor={`${prefix}-${key}`}
        inherited={value[key] === null}
        hideLabel={key === "model" && fields === "modelOnly"}
        className={`setting-field gap-space-1 ${key === "model" && fields === "modelOnly" ? "model-form-field" : ""}  ${messages.length || rejected ? "setting-diagnostic [&_input]:border-danger [&_.select-trigger]:border-danger" : ""}`}
        data-setting-field={key}
        key={key}
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
        description={
          lockReason || unsupported ? (
            <>
              {lockReason && (
                <Row
                  gap={0}
                  as="small"
                  id={`${prefix}-${key}-constraint`}
                  className="setting-constraint [&_>_svg]:flex-none [&_>_svg]:mt-[2px] flex items-start gap-space-1 text-muted text-[10px] leading-[1.6]"
                >
                  <LockKeyhole size={12} aria-hidden />
                  <span>
                    {lockReason}
                    {value[key] !== null && (
                      <>
                        {" "}
                        {t("prompt.savedOverrideKept", { value0: settingValue(key, value[key]) })}
                      </>
                    )}
                  </span>
                </Row>
              )}
              {unsupported && (
                <small className="setting-note text-muted text-[10px] leading-[1.6]">
                  {t("prompt.unsupportedSettingKept")}
                </small>
              )}
            </>
          ) : undefined
        }
        error={
          messages.length || rejected ? (
            <>
              {messages.length > 0 && (
                <output
                  id={`${prefix}-${key}-diagnostic`}
                  className="setting-message [&_p]:m-0 text-danger text-caption leading-[1.6]"
                >
                  {messages.map((item, index) => (
                    <p key={index}>{settingDiagnosticMessage(item.field, item.change)}</p>
                  ))}
                </output>
              )}
              {rejected && (
                <small className="setting-message [&_p]:m-0 text-danger text-caption leading-[1.6]">
                  {t("prompt.invalidSetting")}
                </small>
              )}
            </>
          ) : undefined
        }
      >
        {control}
      </Field>
    );
  };

  const controlProps = (key: SettingKey, locked = false) => ({
    id: `${prefix}-${key}`,
    "aria-describedby":
      [
        locked ? `${prefix}-${key}-constraint` : "",
        diagnosticsFor(key).length ? `${prefix}-${key}-diagnostic` : "",
      ]
        .filter(Boolean)
        .join(" ") || undefined,
    "aria-invalid": errorFields.some((field) => diagnosticSetting(field) === key) || undefined,
  });

  const number = (key: "steps" | "scale" | "seed" | "nSamples" | "cfgRescale", help?: string) => {
    const range = key === "seed" ? undefined : capabilities?.ranges[key];
    const fixed = range !== undefined && range.min === range.max;
    const numericInput = (
      <Input
        {...controlProps(key, fixed)}
        disabled={fixed}
        type="number"
        step={key === "scale" || key === "cfgRescale" ? "any" : 1}
        min={range?.min}
        max={range?.max}
        value={fixed ? range.min : (value[key] ?? "")}
        placeholder={inherited(key)}
        onChange={(event) => {
          if (event.target.value === "") change(key, null);
          else if (Number.isFinite(event.target.valueAsNumber))
            change(key, event.target.valueAsNumber);
        }}
      />
    );
    const sliderValue = fixed ? range.min : (value[key] ?? effective?.[key]);
    const hasSlider = (key === "steps" || key === "scale") && range && sliderValue !== undefined;
    return wrapper(
      key,
      hasSlider ? (
        <Grid
          gap={0}
          className="setting-slider [&_input]:w-full [&_input]:min-w-0 [&_input[type=range]]:h-[20px] [&_input[type=range]]:p-0 [&_input[type=range]]:border-0 [&_input[type=range]]:[accent-color:var(--accent)] [&_input[type=range]]:bg-transparent grid grid-cols-[minmax(0,_1fr)_106px] items-center gap-[10px]"
        >
          <input
            type="range"
            aria-label={t("prompt.settingSlider", { value0: settingLabels[key] })}
            aria-invalid={controlProps(key)["aria-invalid"]}
            aria-describedby={controlProps(key, fixed)["aria-describedby"]}
            min={range.min}
            max={range.max}
            step={key === "steps" ? 1 : "any"}
            value={Math.max(range.min, Math.min(range.max, sliderValue))}
            disabled={fixed}
            onChange={(event) => change(key, event.currentTarget.valueAsNumber)}
          />
          {numericInput}
        </Grid>
      ) : (
        numericInput
      ),
      help,
      fixed ? t("prompt.fixedValueLocked", { value0: range.min }) : undefined,
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
    const locked = fixed !== null && fixed !== undefined;
    const hasCurrent = current !== null && choices?.includes(current);
    return wrapper(
      key,
      <Select
        {...controlProps(key, locked)}
        disabled={locked}
        value={locked ? fixed : (current ?? "")}
        onValueChange={(next) => change(key, (next || null) as GenerationSettings[K])}
        options={
          locked
            ? [{ value: fixed, label: settingValue(key, fixed) }]
            : [
                { value: "", label: inherited(key) },
                ...(current !== null && !hasCurrent
                  ? [
                      {
                        value: current,
                        label: `${settingValue(key, current)}${t("prompt.savedTag")}`,
                      },
                    ]
                  : []),
                ...(choices?.map((option) => ({
                  value: option,
                  label: settingValue(key, option),
                })) ?? []),
              ]
        }
      />,
      help,
      locked ? t("prompt.fixedValueLocked", { value0: settingValue(key, fixed) }) : undefined,
      !locked && current !== null && choices !== undefined && !hasCurrent,
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
        {...controlProps(key, supported === false)}
        disabled={supported === false}
        value={supported === false ? "false" : value[key] === null ? "" : String(value[key])}
        onValueChange={(next) => change(key, next === "" ? null : next === "true")}
        options={[
          { value: "", label: inherited(key) },
          { value: "true", label: t("prompt.on"), disabled: supported === false },
          { value: "false", label: t("prompt.off") },
        ]}
      />,
      help,
      supported === false ? t("prompt.unsupportedSettingLocked") : undefined,
    );

  const advancedCount = advancedSettingKeys.filter((key) => value[key] !== null).length;
  const advancedSummary = advancedCount
    ? t("prompt.configuredCount", { count: advancedCount })
    : "";
  const fixedSamples =
    capabilities && capabilities.ranges.nSamples.min === capabilities.ranges.nSamples.max
      ? capabilities.ranges.nSamples.min
      : undefined;
  return (
    <div className="settings-editor [&_>_*_+_*]:mt-space-3" data-setting-editor={mode}>
      {(fields === "all" || fields === "model" || fields === "modelOnly") && (
        <Grid className="settings-fields [&_input]:h-[30px] [&_input]:rounded-control [&_input]:text-label [&_.select-trigger]:h-[30px] [&_.select-trigger]:rounded-control [&_.select-trigger]:text-label grid grid-cols-1 gap-y-space-2 gap-x-space-3 settings-model">
          {options("model", models)}
          {fields !== "modelOnly" && boolean("furryMode", capabilities?.furryMode)}
        </Grid>
      )}
      {(fields === "all" || fields === "prompt" || fields === "promptOptions") && (
        <Grid
          minColumnWidth="110px"
          className="settings-fields [&_input]:h-[30px] [&_input]:rounded-control [&_input]:text-label [&_.select-trigger]:h-[30px] [&_.select-trigger]:rounded-control [&_.select-trigger]:text-label grid gap-y-space-2 gap-x-space-3 settings-prompt "
        >
          {options("quality", capabilities?.qualityPresets, t("prompt.qualityTagsHelp"))}
          {options("ucPreset", capabilities?.ucPresets, t("prompt.negativePresetHelp"))}
          {fields === "promptOptions" && boolean("furryMode", capabilities?.furryMode)}
          {(capabilities?.transparentBackground || value.transparentBackground !== null) &&
            boolean(
              "transparentBackground",
              capabilities?.transparentBackground,
              t("prompt.transparentBackgroundHelp"),
            )}
        </Grid>
      )}
      {(fields === "all" || fields === "image") && (
        <Grid className="settings-fields [&_input]:h-[30px] [&_input]:rounded-control [&_input]:text-label [&_.select-trigger]:h-[30px] [&_.select-trigger]:rounded-control [&_.select-trigger]:text-label grid grid-cols-1 gap-y-space-2 gap-x-space-3 settings-image">
          {wrapper(
            "size",
            <Grid gap={0} align="stretch" columns={1} className="size-editor grid gap-space-2">
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
              <InputRow className="size-inputs [&_input]:flex-1 [&_input]:w-0 [&_.icon-button]:w-[25px] flex gap-[5px] items-center">
                <Input
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
                <Input
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
              </InputRow>
            </Grid>,
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
                <Row
                  gap={0}
                  align="stretch"
                  as="fieldset"
                  className="sample-options [&_>_button]:[flex:1_0_28px] [&_>_button]:px-[5px] [&_>_button[aria-pressed=true]]:bg-accent-soft [&_>_button[aria-pressed=true]]:text-accent [&_>_button[aria-pressed=true]]:border-accent [&_.sample-inherit]:[flex:0_0_auto] flex flex-wrap gap-[3px]"
                  aria-label={t("prompt.samples")}
                  aria-describedby={
                    controlProps("nSamples", fixedSamples !== undefined)["aria-describedby"]
                  }
                  disabled={fixedSamples !== undefined}
                >
                  <Button
                    id={`${prefix}-nSamples`}
                    type="button"
                    className="sample-inherit"
                    title={inherited("nSamples")}
                    aria-pressed={fixedSamples === undefined && value.nSamples === null}
                    onClick={() => change("nSamples", null)}
                  >
                    {t("prompt.inherit")}
                  </Button>
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
                    <Button
                      type="button"
                      key={count}
                      aria-pressed={(fixedSamples ?? value.nSamples) === count}
                      onClick={() => change("nSamples", count)}
                    >
                      {count}
                    </Button>
                  ))}
                  {fixedSamples === undefined &&
                    value.nSamples !== null &&
                    (value.nSamples < capabilities.ranges.nSamples.min ||
                      value.nSamples > capabilities.ranges.nSamples.max) && (
                      <output className="sample-saved flex items-center py-[3px] px-space-2 border border-danger rounded-control text-danger">
                        {value.nSamples}
                        {t("prompt.savedTag")}
                      </output>
                    )}
                </Row>,
                t("prompt.samplesHelp"),
                fixedSamples !== undefined
                  ? t("prompt.fixedValueLocked", { value0: fixedSamples })
                  : undefined,
              )
            : number("nSamples", t("prompt.samplesHelp"))}
        </Grid>
      )}
      {(fields === "all" || fields === "parameters") && (
        <>
          <Grid
            minColumnWidth="110px"
            className="settings-fields [&_input]:h-[30px] [&_input]:rounded-control [&_input]:text-label [&_.select-trigger]:h-[30px] [&_.select-trigger]:rounded-control [&_.select-trigger]:text-label grid gap-y-space-2 gap-x-space-3 settings-main [&_>_:is([data-setting-field=steps],_[data-setting-field=scale])]:col-span-full "
          >
            {number("steps")}
            {number("scale")}
            {number("seed", t("prompt.seedHelp"))}
            {options("sampler", capabilities?.samplers, undefined, capabilities?.fixedSampler)}
          </Grid>
          <details
            className="advanced-settings [&_summary_small]:text-muted [&_summary_small]:text-[10px] [&_summary_small]:leading-[1.6] [&_summary]:text-label [&_summary]:cursor-pointer [&_summary_small]:ml-space-3 [&[open]_>_.settings-fields]:mt-[10px] [&_>_.settings-fields]:grid-cols-2 border-t border-line-subtle pt-[10px]"
            ref={advanced}
          >
            <summary>
              <span>{t("prompt.advancedSettings")}</span>
              {advancedSummary && <small>{advancedSummary}</small>}
            </summary>
            <Grid className="settings-fields [&_input]:h-[30px] [&_input]:rounded-control [&_input]:text-label [&_.select-trigger]:h-[30px] [&_.select-trigger]:rounded-control [&_.select-trigger]:text-label grid grid-cols-1 gap-y-space-2 gap-x-space-3">
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
              <h4 className="settings-group-title col-span-full [margin:7px_0_0] text-muted text-caption font-[550]">
                {t("prompt.output")}
              </h4>
              {options("alphaMode", capabilities?.alphaModes)}
              {options("imageFormat", capabilities?.imageFormats)}
              {options(
                "responseFormat",
                capabilities?.responseFormats,
                t("prompt.responseFormatHelp"),
              )}
              {advancedContent && (
                <h4 className="settings-group-title col-span-full [margin:7px_0_0] text-muted text-caption font-[550]">
                  {t("prompt.execution")}
                </h4>
              )}
              {advancedContent}
            </Grid>
          </details>
        </>
      )}
    </div>
  );
}
