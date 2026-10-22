import { describe, expect, it } from "vitest";
import { diagnosticSetting, settingsWithDefaults, settingValue } from "./settings";
import { emptySettings } from "./model";
import type { ResolvedSettings } from "../../bindings/workbench";

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
