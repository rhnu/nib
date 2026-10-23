import { describe, expect, it } from "vitest";
import type { MaskSession } from "../../bindings/workbench";
import {
  appendCommand,
  appendStrokePoints,
  binaryMaskPixels,
  canvasTransform,
  containMaskRect,
  nativePoint,
  overlayMaskPixels,
  redoMask,
  undoMask,
  zoomAt,
} from "./model";

function session(): MaskSession {
  return {
    sourceAssetId: "source",
    width: 200,
    height: 100,
    baseMaskAssetId: null,
    commands: [],
    cursor: 0,
    revision: 0,
    appliedRevision: 0,
    appliedMaskAssetId: null,
    brushSize: 20,
    zoom: 1,
    panX: 0,
    panY: 0,
  };
}

describe("native mask coordinates", () => {
  it("inverts zoom, centering and pan without changing native image dimensions", () => {
    const transform = canvasTransform(
      { ...session(), zoom: 2, panX: 30, panY: -20 },
      { width: 400, height: 300 },
    );
    expect(transform).toEqual({ scale: 2, x: 30, y: 30 });
    expect(nativePoint({ x: 130, y: 80 }, transform)).toEqual({ x: 50, y: 25 });
  });
  it("keeps the pixel under the pointer fixed during zoom", () => {
    const next = zoomAt(session(), { width: 400, height: 300 }, { x: 150, y: 125 }, 2);
    expect({ zoom: next.zoom, panX: next.panX, panY: next.panY }).toEqual({
      zoom: 2,
      panX: 50,
      panY: 25,
    });
    expect(next.width).toBe(200);
    expect(next.height).toBe(100);
    expect(next.revision).toBe(0);
  });
  it("keeps out-of-image stroke points available for canvas clipping", () => {
    expect(nativePoint({ x: -20, y: 250 }, { scale: 2, x: 0, y: 10 })).toEqual({ x: -10, y: 120 });
  });
  it("contains a differently sized base mask without stretching its aspect", () => {
    expect(containMaskRect({ width: 3, height: 2 }, { width: 8, height: 8 })).toEqual({
      x: 0,
      y: 1,
      width: 8,
      height: 5,
    });
  });
});

describe("persisted mask history", () => {
  it("persists a one-point brush dot before pointerup and extends that same command", () => {
    const initial = session();
    const dot = appendCommand(initial, { kind: "paint", size: 20, points: [{ x: 10, y: 20 }] });
    expect(dot.cursor).toBe(1);
    expect(dot.commands).toEqual([{ kind: "paint", size: 20, points: [{ x: 10, y: 20 }] }]);
    const moved = appendStrokePoints(dot, 0, [{ x: 30, y: 20 }]);
    expect(moved.cursor).toBe(1);
    expect(moved.commands).toEqual([
      {
        kind: "paint",
        size: 20,
        points: [
          { x: 10, y: 20 },
          { x: 30, y: 20 },
        ],
      },
    ]);
    expect(moved.revision).toBe(2);
    expect(initial.commands).toEqual([]);
  });
  it("does not add duplicate pointer samples", () => {
    const dot = appendCommand(session(), { kind: "erase", size: 4, points: [{ x: 2, y: 3 }] });
    expect(appendStrokePoints(dot, 0, [{ x: 2, y: 3 }])).toBe(dot);
  });
  it("keeps coalesced sample order and drops adjacent duplicates in one edit", () => {
    const dot = appendCommand(session(), { kind: "paint", size: 4, points: [{ x: 1, y: 1 }] });
    const next = appendStrokePoints(dot, 0, [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
    ]);
    expect(next.commands[0]).toEqual({
      kind: "paint",
      size: 4,
      points: [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
        { x: 3, y: 2 },
      ],
    });
    expect(next.revision).toBe(2);
    expect(dot.commands[0]).toEqual({ kind: "paint", size: 4, points: [{ x: 1, y: 1 }] });
  });
  it("makes clear undoable and preserves its redo command", () => {
    const painted = appendCommand(session(), { kind: "paint", size: 10, points: [{ x: 5, y: 5 }] });
    const cleared = appendCommand(painted, { kind: "clear" });
    const undo = undoMask(cleared);
    expect(undo.cursor).toBe(1);
    expect(undo.commands).toHaveLength(2);
    expect(undo.revision).toBe(3);
    const redo = redoMask(undo);
    expect(redo.cursor).toBe(2);
    expect(redo.commands[1]).toEqual({ kind: "clear" });
    expect(redo.revision).toBe(4);
  });
  it("drops only the redo branch when painting after undo", () => {
    const clear = appendCommand(session(), { kind: "clear" });
    const erased = appendCommand(clear, { kind: "erase", size: 8, points: [{ x: 10, y: 10 }] });
    const next = appendCommand(undoMask(erased), {
      kind: "paint",
      size: 4,
      points: [{ x: 20, y: 20 }],
    });
    expect(next.cursor).toBe(2);
    expect(next.commands.map((command) => command.kind)).toEqual(["clear", "paint"]);
    expect(redoMask(next)).toBe(next);
  });
  it("does not modify the applied checkpoint during edits or undo", () => {
    const initial = { ...session(), baseMaskAssetId: "base", appliedMaskAssetId: "applied" };
    const next = undoMask(appendCommand(initial, { kind: "clear" }));
    expect(next.baseMaskAssetId).toBe("base");
    expect(next.appliedMaskAssetId).toBe("applied");
    expect(next.appliedRevision).toBe(0);
  });
});

describe("mask raster semantics", () => {
  it("exports selected pixels white and unselected pixels black with fully opaque alpha", () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 0, 255, 0, 0, 255,
    ]);
    expect([...binaryMaskPixels(pixels)]).toEqual([
      0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255,
    ]);
    expect([...pixels].slice(8, 12)).toEqual([255, 255, 255, 0]);
  });
  it("shows selection color only on selected pixels without changing the binary mask", () => {
    const mask = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    const overlay = overlayMaskPixels(mask);
    expect(overlay[3]).toBe(0);
    expect(overlay[7]).toBeGreaterThan(0);
    expect(overlay[7]).toBeLessThan(255);
    expect([...mask]).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });
});
