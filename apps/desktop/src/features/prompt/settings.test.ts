import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@/shared/i18n";
import { diagnosticSetting, settingsWithDefaults, settingValue } from "./settings";
import { emptySettings } from "./model";
import type { ResolvedSettings } from "@/bindings/workbench";

// Presentation assertions select their language independently of the runner's locale.
const previousLanguage = i18n.language;
beforeAll(() => i18n.changeLanguage("zh-CN"));
afterAll(() => i18n.changeLanguage(previousLanguage));

describe("setting diagnostics", () => {
  it("maps SDK paths and guidance aliases to the visible controls", () => {
    expect(diagnosticSetting("sampling.noise_schedule")).toBe("noiseSchedule");
    expect(diagnosticSetting("core.size.width")).toBe("size");
    expect(diagnosticSetting("guidance.dynamic_thresholding")).toBe("decrisp");
    expect(diagnosticSetting("guidance.smea_dyn")).toBe("smeaDyn");
    expect(diagnosticSetting("references.precise[0].strength")).toBeNull();
  });
});

describe("sparse settings presentation", () => {
  it("formats provider identifiers for readable selections and inherited values", () => {
    expect(settingValue("model", "nai-diffusion-4-5-full")).toBe("NAI Diffusion 4.5 Full");
    expect(settingValue("sampler", "k_euler_ancestral")).toBe("Euler A");
    expect(settingValue("sampler", "k_dpm_2_ancestral")).toBe("DPM2 A");
    expect(settingValue("noiseSchedule", "karras")).toBe("Karras");
    expect(settingValue("alphaMode", "premultiplied")).toBe("预乘");
    expect(settingValue("imageFormat", "webp")).toBe("WEBP");
    expect(settingValue("responseFormat", "json")).toBe("JSON");
    expect(settingValue("quality", "standard")).toBe("标准");
    expect(settingValue("quality", "none")).toBe("关闭");
    expect(settingValue("ucPreset", "light")).toBe("轻度");
    expect(settingValue("ucPreset", "furry_focus")).toBe("兽人优先");
    expect(settingValue("sampler", "future_sampler")).toBe("future_sampler");
  });

  it("distinguishes automatic seed, explicit false and absent overrides", () => {
    expect(settingValue("seed", 0)).toBe("自动（0）");
    expect(settingValue("varietyBoost", false)).toBe("关闭");
    expect(settingValue("varietyBoost", null)).toBe("未设置");
  });

  it("previews inheritance while retaining false and zero without changing the sparse input", () => {
    const values = { ...emptySettings(), seed: 0, varietyBoost: false };
    const defaults = { seed: 42, varietyBoost: true, steps: 25 } as ResolvedSettings;
    const effective = settingsWithDefaults(defaults, values);
    expect(effective.seed).toBe(0);
    expect(effective.varietyBoost).toBe(false);
    expect(effective.steps).toBe(25);
    expect(values.steps).toBeNull();
  });
});
