import { describe, it, expect } from "vitest";
import { checkWordBudget, checkBeatCoverage, dedupeHashtags, buildWarnings } from "./validators";

describe("checkWordBudget", () => {
  it("flags within 10% tolerance as ok", () => {
    const body = "word ".repeat(70).trim();
    const r = checkWordBudget({ hook: "five words here hello world", body, cta: "save this for later" }, 30);
    expect(r.target).toBe(75);
    expect(r.withinTolerance).toBe(true);
  });

  it("flags >10% as over budget", () => {
    const body = "word ".repeat(150).trim();
    const r = checkWordBudget({ hook: "hi", body, cta: "go" }, 30);
    expect(r.withinTolerance).toBe(false);
    expect(r.overBy).toBeGreaterThan(0);
  });
});

describe("checkBeatCoverage", () => {
  it("accepts coverage within ±1s of target", () => {
    const r = checkBeatCoverage([{ start: 0, end: 15 }, { start: 15, end: 30 }], 30);
    expect(r.coveredSec).toBe(30);
    expect(r.withinTolerance).toBe(true);
  });

  it("flags short coverage", () => {
    const r = checkBeatCoverage([{ start: 0, end: 10 }], 30);
    expect(r.withinTolerance).toBe(false);
  });
});

describe("dedupeHashtags", () => {
  it("removes case-insensitive duplicates preserving the first occurrence", () => {
    expect(dedupeHashtags(["#Money", "#money", "#FYP", "#fyp", "#investing"])).toEqual([
      "#Money",
      "#FYP",
      "#investing",
    ]);
  });
});

describe("buildWarnings", () => {
  it("emits both warnings when both checks fail", () => {
    const w = buildWarnings({
      hook: "hi",
      body: "word ".repeat(200).trim(),
      cta: "bye",
      beats: [{ start: 0, end: 5 }],
      targetLengthSec: 30,
    });
    const kinds = w.map((x) => x.kind).sort();
    expect(kinds).toEqual(["beat_coverage", "word_budget"]);
  });

  it("returns no warnings on a clean script", () => {
    const body = "word ".repeat(70).trim();
    const w = buildWarnings({
      hook: "five words here hello world",
      body,
      cta: "save this for later",
      beats: [{ start: 0, end: 30 }],
      targetLengthSec: 30,
    });
    expect(w).toEqual([]);
  });
});
