import { t } from "@/shared/i18n";
import type { GenerationSettings, ResolvedSettings } from "@/bindings/workbench";

export const settingLabels = {
  get model() {
    return t("prompt.model");
  },
  get furryMode() {
    return t("prompt.furryMode");
  },
  get quality() {
    return t("prompt.qualityTags");
  },
  get ucPreset() {
    return t("prompt.negativePreset");
  },
  get size() {
    return t("prompt.dimensions");
  },
  get nSamples() {
    return t("prompt.samples");
  },
  get steps() {
    return t("prompt.steps");
  },
  get scale() {
    return t("prompt.guidance");
  },
  get seed() {
    return t("prompt.seed");
  },
  get sampler() {
    return t("prompt.sampler");
  },
  get noiseSchedule() {
    return t("prompt.noiseSchedule");
  },
  get cfgRescale() {
    return t("prompt.cfgRescale");
  },
  get varietyBoost() {
    return t("prompt.varietyBoost");
  },
  get decrisp() {
    return t("prompt.decrisp");
  },
  get smea() {
    return t("prompt.smea");
  },
  get smeaDyn() {
    return t("prompt.dynamicSmea");
  },
  get legacyUc() {
    return t("prompt.legacyUc");
  },
  get transparentBackground() {
    return t("prompt.transparentBackground");
  },
  get alphaMode() {
    return t("prompt.alphaRepresentation");
  },
  get imageFormat() {
    return t("prompt.imageFormat");
  },
  get responseFormat() {
    return t("prompt.responseFormat");
  },
  get useCoords() {
    return t("prompt.characterPositioning");
  },
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
  if (value === null) return key === "imageFormat" ? t("prompt.defaultFormat") : t("prompt.unset");
  if (typeof value === "boolean") return value ? t("prompt.on") : t("prompt.off");
  if (typeof value === "object") return `${value.width} × ${value.height}`;
  if (key === "seed" && value === 0) return t("prompt.automaticZero");
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
        panel?.querySelector<HTMLElement>('[role="textbox"], textarea') ??
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
