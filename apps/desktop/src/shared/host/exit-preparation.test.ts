import { describe, expect, it } from "vitest";
import { ExitPreparation } from "./exit-preparation";

describe("exit preparation", () => {
  it("requires an active surface to approve exit", async () => {
    const preparation = new ExitPreparation();
    expect(await preparation.run()).toBe(false);
    const unregister = preparation.register(async () => false);
    expect(await preparation.run()).toBe(false);
    unregister();
    expect(await preparation.run()).toBe(false);
  });

  it("keeps the new surface active when the old surface unmounts", async () => {
    const preparation = new ExitPreparation();
    const oldSurface = preparation.register(async () => false);
    const newSurface = preparation.register(async () => true);
    oldSurface();
    expect(await preparation.run()).toBe(true);
    newSurface();
    expect(await preparation.run()).toBe(false);
  });
});
