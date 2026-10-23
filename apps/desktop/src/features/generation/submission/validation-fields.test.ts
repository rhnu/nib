import { describe, expect, it } from "vitest";
import { validationFields } from "./use-generation-quote";

describe("SDK validation error fields", () => {
  it("uses structured fields without interpreting error message text", () => {
    expect(
      validationFields({
        message: "sampling.steps was invalid",
        validationFields: ["core.size.width", 7],
      }),
    ).toEqual(["core.size.width"]);
    expect(validationFields({ message: "sampling.steps was invalid" })).toEqual([]);
  });

  it("keeps transport and unstructured failures unlocated", () => {
    expect(validationFields(null)).toEqual([]);
    expect(validationFields("request failed")).toEqual([]);
    expect(validationFields({ validationFields: "sampling.steps" })).toEqual([]);
  });
});
