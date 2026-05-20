import { describe, it, expect } from "vitest";
import { shouldRescore } from "./diff";

describe("shouldRescore", () => {
  it("returns false for identical strings", () => {
    expect(shouldRescore("hello world", "hello world")).toBe(false);
  });

  it("returns false for whitespace-only edits", () => {
    expect(shouldRescore("hello world", "  hello   world  ")).toBe(false);
  });

  it("returns false for a sub-5% edit", () => {
    const before = "a".repeat(200);
    const after = "a".repeat(199) + "b"; // 1/200 = 0.5%
    expect(shouldRescore(before, after)).toBe(false);
  });

  it("returns true for a >=5% edit", () => {
    const before = "a".repeat(100);
    const after = "a".repeat(94) + "bcdefg"; // 6/100 = 6%
    expect(shouldRescore(before, after)).toBe(true);
  });

  it("returns true for a small absolute change on a short string", () => {
    expect(shouldRescore("hello", "world")).toBe(true);
  });
});
