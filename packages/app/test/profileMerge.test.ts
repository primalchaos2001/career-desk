import { describe, expect, it } from "vitest";
import { blankWorkspace, mergeProfileEdit } from "../src/lib/workspace";

const base = () => ({ ...blankWorkspace().profile, name: "Asha", email: "asha@example.com" });

describe("mergeProfileEdit", () => {
  it("keeps changes made elsewhere to fields the form didn't touch", () => {
    const opened = base();
    const latest = { ...opened, email: "new@example.com" };
    const edited = { ...opened, name: "Asha Sharma" };
    expect(mergeProfileEdit(latest, opened, edited)).toMatchObject({
      name: "Asha Sharma",
      email: "new@example.com",
    });
  });
  it("refuses when the same field was changed elsewhere", () => {
    const opened = base();
    expect(() =>
      mergeProfileEdit({ ...opened, name: "Asha Updated" }, opened, { ...opened, name: "Old tab" }),
    ).toThrow(/changed in another tab.*\(name\)/);
  });
  it("accepts the same change made in both places", () => {
    const opened = base();
    const both = { ...opened, name: "Same" };
    expect(mergeProfileEdit(both, opened, both).name).toBe("Same");
  });
});
