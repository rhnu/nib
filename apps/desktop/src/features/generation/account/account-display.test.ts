import { describe, expect, it } from "vitest";
import { allowanceText, recoveryHours } from "./account-display";

describe("account allowance display", () => {
  it("omits zero purchased allowance", () => {
    expect(
      allowanceText({
        isNegative: false,
        percent: 99,
        purchasedPercent: 0,
        secondsUntilNextPercent: 0,
      }),
    ).toBe("99%");
  });

  it("shows purchased allowance separately and preserves overdrawn state", () => {
    expect(
      allowanceText({
        isNegative: false,
        percent: 99,
        purchasedPercent: 20,
        secondsUntilNextPercent: 0,
      }),
    ).toBe("99% (+20%)");
    expect(
      allowanceText({
        isNegative: true,
        percent: 5,
        purchasedPercent: 20,
        secondsUntilNextPercent: 0,
      }),
    ).toBe("−5% (+20%)");
  });

  it.each([
    [0, 0],
    [1, 0.5],
    [1497, 0.5],
    [1800, 0.5],
    [1801, 1],
    [3600, 1],
    [3601, 1.5],
  ])("rounds %i seconds up to %s hours", (seconds, hours) => {
    expect(recoveryHours(seconds)).toBe(hours);
  });
});
