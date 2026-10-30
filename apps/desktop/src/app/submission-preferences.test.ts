import { describe, expect, it, vi } from "vitest";
import type { ApplicationPreferences } from "@/bindings/settings";
import { PreferencesWriter } from "./preferences-writer";
import { prepareSubmissionPreferences } from "./submission-preferences";

const initial: ApplicationPreferences = {
  theme: "dark",
  recentImageLimit: 20,
  execution: { imageBaseUrl: null, imageRequestEncoding: "json", serverImageCache: false },
};

describe("submission preference barrier", () => {
  it.each([
    { from: null, to: "https://example.test/novelai" },
    { from: "https://example.test/novelai", to: null },
  ])("requires a new quote when changing the endpoint from $from to $to", async ({ from, to }) => {
    const writer = new PreferencesWriter(async (value) => value);
    writer.initialize({ ...initial, execution: { ...initial.execution, imageBaseUrl: from } });
    writer.edit({ ...initial, execution: { ...initial.execution, imageBaseUrl: to } });
    await expect(prepareSubmissionPreferences(writer)).rejects.toThrow("等待费用重新估算");
    await expect(prepareSubmissionPreferences(writer)).resolves.toBeUndefined();
    expect(writer.getSavedSnapshot()?.execution.imageBaseUrl).toBe(to);
  });

  it("awaits a pending execution write and requires a fresh quote before submission", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let saved = initial;
    const writer = new PreferencesWriter(async (value) => {
      await pending;
      saved = value;
      return value;
    });
    writer.initialize(initial);
    writer.edit({
      ...initial,
      execution: { imageBaseUrl: null, imageRequestEncoding: "multipart", serverImageCache: true },
    });
    const submit = vi.fn();
    const ready = prepareSubmissionPreferences(writer).then(submit);
    const expected = expect(ready).rejects.toThrow("等待费用重新估算");
    await Promise.resolve();
    expect(submit).not.toHaveBeenCalled();
    release();
    await expected;
    expect(saved.execution.imageRequestEncoding).toBe("multipart");
    await prepareSubmissionPreferences(writer).then(submit);
    expect(submit).toHaveBeenCalledOnce();
  });

  it("propagates a write failure and permits appearance-only writes without invalidating a quote", async () => {
    let saved = initial;
    const write = vi
      .fn<(value: ApplicationPreferences) => Promise<ApplicationPreferences>>()
      .mockRejectedValueOnce(new Error("write failed"))
      .mockImplementation(async (value) => {
        saved = value;
        return value;
      });
    const writer = new PreferencesWriter(write);
    writer.initialize(initial);
    writer.edit({ ...initial, theme: "light" });
    await expect(prepareSubmissionPreferences(writer)).rejects.toThrow("write failed");
    await prepareSubmissionPreferences(writer);
    expect(saved.theme).toBe("light");
  });
});
