import type { GenerationSettings, ResolvedSettings } from "@/bindings/workbench";

export const settingLabels = {
  model: "模型",
  furryMode: "Furry 模式",
  quality: "质量标签",
  ucPreset: "负面预设",
  size: "尺寸",
  nSamples: "样本数",
  steps: "Steps",
  scale: "Guidance",
  seed: "种子",
  sampler: "采样器",
  noiseSchedule: "噪声调度",
  cfgRescale: "CFG Rescale",
  varietyBoost: "Variety Boost",
  decrisp: "Decrisp",
  smea: "SMEA",
  smeaDyn: "动态 SMEA",
  legacyUc: "Legacy UC",
  transparentBackground: "透明背景",
  alphaMode: "Alpha 表示",
  imageFormat: "图像格式",
  responseFormat: "响应格式",
  useCoords: "角色定位",
} satisfies Record<keyof GenerationSettings, string>;

export type SettingKey = keyof GenerationSettings;
export const settingKeys = Object.keys(settingLabels) as SettingKey[];
export const advancedSettingKeys: SettingKey[] = [
  "noiseSchedule",
  "cfgRescale",
  "varietyBoost",
  "decrisp",
  "smea",
  "smeaDyn",
  "legacyUc",
  "alphaMode",
  "imageFormat",
  "responseFormat",
];

/** SDK diagnostics use request paths; the editor uses camelCase application fields. */
export function diagnosticSetting(field: string): SettingKey | null {
  const parts = field.split(/[.[\]/]+/).map((part) => part.replaceAll("_", "").toLowerCase());
  if (parts.some((part) => ["width", "height", "size", "resolution"].includes(part))) return "size";
  const aliases: Record<string, SettingKey> = {
    guidance: "scale",
    cfgscale: "scale",
    skipcfgabovesigma: "varietyBoost",
    dynamicthresholding: "decrisp",
    sm: "smea",
    smdyn: "smeaDyn",
    format: "imageFormat",
  };
  for (const part of [...parts].reverse()) {
    const key = settingKeys.find((key) => key.toLowerCase() === part) ?? aliases[part];
    if (key) return key;
  }
  return null;
}

/** Preview inheritance without materializing defaults into the saved sparse values. */
export function settingsWithDefaults<T extends GenerationSettings | ResolvedSettings>(
  defaults: T,
  values: GenerationSettings,
): T {
  return {
    ...defaults,
    ...Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null)),
  };
}

export function settingValue(
  key: SettingKey,
  value: GenerationSettings[SettingKey] | ResolvedSettings[SettingKey],
): string {
  if (value === null) return key === "imageFormat" ? "默认格式" : "未设置";
  if (typeof value === "boolean") return value ? "开启" : "关闭";
  if (typeof value === "object") return `${value.width} × ${value.height}`;
  if (key === "seed" && value === 0) return "自动（0）";
  return String(value);
}

/** Reveal collapsed containers before focusing the actual setting control. */
export function focusSetting(field: string, root: ParentNode = document): boolean {
  const promptPath = field.replaceAll("_", "").toLowerCase();
  if (["core.prompt", "core.negativeprompt", "customnegativeprompts"].includes(promptPath)) {
    const scope = promptPath === "core.prompt" ? "positive" : "negative";
    const tab = root.querySelector<HTMLElement>(`.prompt-workspace [data-prompt-tab="${scope}"]`);
    if (!tab) return false;
    tab.click();
    requestAnimationFrame(() => {
      const panel = root.querySelector<HTMLElement>(
        `.prompt-workspace [data-prompt-scope="${scope}"]`,
      );
      const control =
        panel?.querySelector<HTMLElement>("textarea") ??
        panel?.querySelector<HTMLElement>("button");
      (control ?? tab).scrollIntoView({ block: "nearest" });
      (control ?? tab).focus();
    });
    return true;
  }
  const inputFields: Record<string, string> = {
    strength: "strength",
    noise: "noise",
    color_correct: "colorCorrect",
    extra_noise_seed: "extraNoiseSeed",
    add_original_image: "addOriginalImage",
    max_enhance: "maxEnhance",
    declared_blur_sigma: "declaredBlurSigma",
    image: "sourceImage",
    mask: "maskAssetId",
    mask_asset_id: "maskAssetId",
    img2img: "img2img",
  };
  const tail = field.split(".").at(-1) ?? "";
  const key = field.startsWith("operation.input.")
    ? inputFields[tail]
    : (diagnosticSetting(field) ??
      field.split(".").find((part) => part === "policy" || part === "stream"));
  if (!key) return false;
  const selector = `[data-setting-field="${key}"]`;
  const target =
    root.querySelector<HTMLElement>(`[data-setting-editor="draft"] ${selector}`) ??
    root.querySelector<HTMLElement>(selector);
  if (!target) {
    const trigger = ["quality", "ucPreset", "furryMode", "transparentBackground"].includes(key)
      ? root.querySelector<HTMLElement>(".prompt-workspace [data-prompt-options-trigger]")
      : null;
    if (!trigger) return false;
    trigger.click();
    requestAnimationFrame(() => {
      const control = root.querySelector<HTMLElement>(`${selector} select`);
      control?.scrollIntoView({ block: "nearest" });
      control?.focus();
    });
    return true;
  }
  for (let parent = target.parentElement; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  }
  target.scrollIntoView({ block: "nearest" });
  (
    target.querySelector<HTMLElement>('input:not([type="range"]), select') ??
    target.querySelector<HTMLElement>("input") ??
    target.querySelector<HTMLElement>("button")
  )?.focus();
  return true;
}
