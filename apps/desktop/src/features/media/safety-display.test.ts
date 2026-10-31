import { describe, expect, it } from "vitest";
import { shouldBlurImage } from "./safety-display";

describe("safety display preferences", () => {
  it.each([undefined, "unknown", "safe"])("shows %s normally", (status) => {
    expect(shouldBlurImage(status, true, false, true)).toBe(false);
  });

  it("blurs NSFW images while leaving details exempt by default", () => {
    expect(shouldBlurImage("nsfw", true, false, false)).toBe(true);
    expect(shouldBlurImage("nsfw", true, true, false)).toBe(false);
    expect(shouldBlurImage("nsfw", true, true, true)).toBe(true);
  });

  it("honors the global blur switch even when detail blur is enabled", () => {
    expect(shouldBlurImage("nsfw", false, false, true)).toBe(false);
    expect(shouldBlurImage("nsfw", false, true, true)).toBe(false);
  });
});
