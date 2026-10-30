import { afterEach, describe, expect, it } from "vitest";
import { i18n, t } from "./runtime";
import { deferMessage, errorMessage, MessageError } from "./messages";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("displaying messages", () => {
  it("selects singular and plural forms using the current language", async () => {
    await i18n.changeLanguage("en");
    expect(t("generation.sampleCount", { count: 1 })).toBe("1 sample");
    expect(t("generation.sampleCount", { count: 2 })).toBe("2 samples");
    await i18n.changeLanguage("zh-CN");
    expect(t("generation.sampleCount", { count: 1 })).toBe("1 个样本");
    expect(t("generation.sampleCount", { count: 2 })).toBe("2 个样本");
  });

  it("keeps every external diagnostic and semantic parameter", () => {
    const detail = "unexpected SDK field: transport.limit (received 37)";
    expect(errorMessage({ kind: "external", detail })).toBe(detail);
    const message = errorMessage({ kind: "numericAdjusted", from: "-0.625", to: "4.875" });
    expect(message).toContain("-0.625");
    expect(message).toContain("4.875");
    expect(errorMessage({ code: "invalid", message: { kind: "external", detail } })).toBe(detail);
  });

  it("explains nested and retained errors again after changing language", async () => {
    const message = { kind: "inputMedia", message: { kind: "mediaUnavailable", id: "source-9" } };
    await i18n.changeLanguage("en");
    const english = errorMessage(message);
    await i18n.changeLanguage("zh-CN");
    const chinese = errorMessage(message);
    expect(chinese).not.toBe(english);
    expect(english).toContain("source-9");
    expect(chinese).toContain("source-9");
  });

  it("preserves Error semantics and evaluates deferred feedback at display time", async () => {
    const raw = { kind: "missingCredentials" };
    const error = new MessageError(deferMessage(() => errorMessage(raw)));
    expect(error).toBeInstanceOf(Error);
    expect(error.stack).toBeTruthy();
    await i18n.changeLanguage("en");
    const english = error.message;
    await i18n.changeLanguage("zh-CN");
    expect(error.message).not.toBe(english);
    expect(errorMessage(error)).toBe(error.message);
  });
});
