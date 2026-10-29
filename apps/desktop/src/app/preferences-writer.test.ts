import { describe, expect, it, vi } from "vitest";
import type { ApplicationPreferences } from "../bindings/settings";
import { PreferencesWriter } from "./preferences-writer";

function preferences(theme: ApplicationPreferences["theme"]): ApplicationPreferences {
  return {
    theme,
    recentImageLimit: 20,
    execution: { imageBaseUrl: null, imageRequestEncoding: "json", serverImageCache: false },
  };
}

describe("PreferencesWriter", () => {
  it("cannot save defaults before preferences have loaded", async () => {
    const write = vi.fn(async (value: ApplicationPreferences) => value);
    const writer = new PreferencesWriter(write);
    expect(() => writer.edit(preferences("light"))).toThrow("尚未加载");
    await writer.flush();
    expect(write).not.toHaveBeenCalled();
  });

  it("preserves execution edits while an earlier appearance write completes", async () => {
    let complete!: (value: ApplicationPreferences) => void;
    const first = new Promise<ApplicationPreferences>((resolve) => {
      complete = resolve;
    });
    const write = vi
      .fn<(value: ApplicationPreferences) => Promise<ApplicationPreferences>>()
      .mockImplementationOnce(() => first)
      .mockImplementation(async (value) => value);
    const writer = new PreferencesWriter(write);
    writer.initialize(preferences("dark"));
    writer.edit(preferences("light"));
    const pending = writer.flush();
    await Promise.resolve();
    const latest: ApplicationPreferences = {
      theme: "light",
      recentImageLimit: 20,
      execution: { imageBaseUrl: null, imageRequestEncoding: "multipart", serverImageCache: true },
    };
    writer.edit(latest);
    expect(writer.flush()).toBe(pending);
    expect(write).toHaveBeenCalledTimes(1);
    complete(preferences("light"));
    await pending;
    expect(write.mock.calls).toEqual([[preferences("light")], [latest]]);
    expect(writer.getSnapshot()).toEqual({
      value: latest,
      dirty: false,
      saving: false,
      error: null,
    });
  });

  it("retains unsaved preferences after failure and retries the latest selection", async () => {
    const failure = new Error("unavailable");
    const write = vi
      .fn<(value: ApplicationPreferences) => Promise<ApplicationPreferences>>()
      .mockRejectedValueOnce(failure)
      .mockImplementation(async (value) => value);
    const writer = new PreferencesWriter(write);
    writer.initialize(preferences("dark"));
    writer.edit(preferences("light"));
    await expect(writer.flush()).rejects.toThrow("unavailable");
    expect(writer.getSnapshot()).toEqual({
      value: preferences("light"),
      dirty: true,
      saving: false,
      error: failure,
    });
    await writer.flush();
    expect(writer.getSnapshot()).toEqual({
      value: preferences("light"),
      dirty: false,
      saving: false,
      error: null,
    });
  });
});
