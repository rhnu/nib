import { describe, expect, it, vi } from "vitest";
import { canLeaveWorkbench } from "./navigation-guard";

describe("workbench navigation protection", () => {
  it("keeps the current route while storage is read only", async () => {
    const waitForInputs = vi.fn(async () => {});
    const confirmMask = vi.fn(async () => true);
    expect(await canLeaveWorkbench({ readOnly: true, waitForInputs, confirmMask })).toBe(false);
    expect(waitForInputs).not.toHaveBeenCalled();
    expect(confirmMask).not.toHaveBeenCalled();
  });
  it("waits for the complete input commit before asking about the canvas", async () => {
    let commit!: () => void;
    const inputs = new Promise<void>((resolve) => {
      commit = resolve;
    });
    const confirmMask = vi.fn(async () => true);
    const navigation = canLeaveWorkbench({
      readOnly: false,
      waitForInputs: () => inputs,
      confirmMask,
    });
    expect(confirmMask).not.toHaveBeenCalled();
    commit();
    expect(await navigation).toBe(true);
    expect(confirmMask).toHaveBeenCalledOnce();
  });
  it("preserves cancellation from the mask decision", async () => {
    expect(
      await canLeaveWorkbench({
        readOnly: false,
        waitForInputs: async () => {},
        confirmMask: async () => false,
      }),
    ).toBe(false);
  });
  it("propagates an input failure without opening another decision", async () => {
    const failure = new Error("input failed");
    const confirmMask = vi.fn(async () => true);
    await expect(
      canLeaveWorkbench({
        readOnly: false,
        waitForInputs: async () => {
          throw failure;
        },
        confirmMask,
      }),
    ).rejects.toBe(failure);
    expect(confirmMask).not.toHaveBeenCalled();
  });
});
