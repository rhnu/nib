import { describe, expect, it } from "vitest";
import type { ResourceComponentStatus } from "@/bindings/downloads";
import { initialComponents, selectComponents } from "./selection";

const component = (
  id: string,
  requires: string[] = [],
  installed = false,
): ResourceComponentStatus => ({
  id,
  requires,
  installed,
  name: id,
  description: "",
  bytes: 0,
});

describe("resource component selection", () => {
  it("starts from installed components rather than clearing optional capabilities", () => {
    expect(
      initialComponents([component("base", [], true), component("model", ["base"], true)]),
    ).toEqual(["base", "model"]);
  });

  it("selects independent components for a first installation", () => {
    expect(initialComponents([component("base"), component("model", ["base"])])).toEqual(["base"]);
  });

  it("restores the pending or failed target selection after reopening management", () => {
    expect(
      initialComponents(
        [component("base", [], true), component("model", ["base"])],
        ["base", "model"],
      ),
    ).toEqual(["base", "model"]);
  });

  it("adds transitive dependencies without changing unrelated selections", () => {
    const components = [
      component("base"),
      component("index", ["base"]),
      component("model", ["index"]),
      component("other"),
    ];
    expect(selectComponents(components, ["other"], "model", true)).toEqual([
      "base",
      "index",
      "model",
      "other",
    ]);
  });

  it("removes transitive dependents when their prerequisite is deselected", () => {
    const components = [
      component("model", ["index"]),
      component("index", ["base"]),
      component("base"),
      component("other"),
    ];
    expect(
      selectComponents(components, ["model", "index", "base", "other"], "base", false),
    ).toEqual(["other"]);
  });

  it("keeps dependencies when an optional component is deselected", () => {
    expect(
      selectComponents(
        [component("base"), component("model", ["base"])],
        ["base", "model"],
        "model",
        false,
      ),
    ).toEqual(["base"]);
  });
});
