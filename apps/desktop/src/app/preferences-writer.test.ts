import { describe, expect, it, vi } from "vitest";
import type { ApplicationPreferences } from "../bindings/settings";
import { PreferencesWriter } from "./preferences-writer";

describe("PreferencesWriter", () => {
  it("cannot save defaults before preferences have loaded", async () => {
    const write = vi.fn(async (value: ApplicationPreferences) => value);
    const writer = new PreferencesWriter(write);
    expect(() => writer.edit({ theme: "light" })).toThrow("尚未加载");
    await writer.flush();
    expect(write).not.toHaveBeenCalled();
  });

  it("serializes theme changes without replacing newer edits with an older response", async () => {
    let complete!: (value: ApplicationPreferences) => void;
    const first = new Promise<ApplicationPreferences>((resolve) => {
      complete = resolve;
    });
    const write = vi
      .fn<(value: ApplicationPreferences) => Promise<ApplicationPreferences>>()
      .mockImplementationOnce(() => first)
      .mockImplementation(async (value) => value);
    const writer = new PreferencesWriter(write);
    writer.initialize({ theme: "dark" });
    writer.edit({ theme: "light" });
    const pending = writer.flush();
    await Promise.resolve();
    writer.edit({ theme: "dark" });
    expect(writer.flush()).toBe(pending);
    expect(write).toHaveBeenCalledTimes(1);
    complete({ theme: "light" });
    await pending;
    expect(write.mock.calls).toEqual([[{ theme: "light" }], [{ theme: "dark" }]]);
    expect(writer.getSnapshot()).toEqual({
      value: { theme: "dark" },
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
    writer.initialize({ theme: "dark" });
    writer.edit({ theme: "light" });
    await expect(writer.flush()).rejects.toThrow("unavailable");
    expect(writer.getSnapshot()).toEqual({
      value: { theme: "light" },
      dirty: true,
      saving: false,
      error: failure,
    });
    await writer.flush();
    expect(writer.getSnapshot()).toEqual({
      value: { theme: "light" },
      dirty: false,
      saving: false,
      error: null,
    });
  });
});
