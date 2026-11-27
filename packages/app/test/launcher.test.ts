import { describe, expect, it } from "vitest";
import { reuseProblem } from "../server/local/main";

describe("reusing a running launcher", () => {
  const want = { build: "abc123", dir: "/home/u/CareerDesk" };

  it("reuses the same build on the same folder", () => {
    expect(reuseProblem({ build: "abc123", folder: "/home/u/CareerDesk" }, want)).toBe("");
  });

  it("refuses an older build, including one that reports no build at all", () => {
    expect(reuseProblem({ build: "old999", folder: want.dir }, want)).toMatch(/different version/);
    expect(reuseProblem({ folder: want.dir }, want)).toMatch(/different version/);
  });

  it("refuses a launcher on another workspace folder", () => {
    expect(reuseProblem({ build: "abc123", folder: "/tmp/other" }, want)).toMatch(
      /another workspace folder/,
    );
  });
});
