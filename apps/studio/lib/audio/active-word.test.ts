import { describe, it, expect } from "vitest";
import { activeWordIndex, type ActiveWord } from "./active-word";

const W = (start: number, end: number): ActiveWord => ({ start, end });

describe("activeWordIndex", () => {
  it("returns -1 on empty array", () => {
    expect(activeWordIndex([], 0)).toBe(-1);
    expect(activeWordIndex([], 5)).toBe(-1);
  });

  it("returns -1 when t is before the first word.start", () => {
    const words = [W(1, 2), W(2, 3), W(3, 4)];
    expect(activeWordIndex(words, 0)).toBe(-1);
    expect(activeWordIndex(words, 0.999)).toBe(-1);
  });

  it("returns the last index when t is past the last word.end (sticky)", () => {
    const words = [W(0, 1), W(1, 2), W(2, 3)];
    expect(activeWordIndex(words, 3.01)).toBe(2);
    expect(activeWordIndex(words, 99)).toBe(2);
  });

  it("treats word.end as inclusive (boundary case)", () => {
    const words = [W(0, 1), W(1, 2), W(2, 3)];
    expect(activeWordIndex(words, 1)).toBe(0);
    expect(activeWordIndex(words, 2)).toBe(1);
    expect(activeWordIndex(words, 3)).toBe(2);
  });

  it("finds the matching word in the middle of the array", () => {
    const words = [W(0, 0.5), W(0.5, 1.0), W(1.0, 1.5), W(1.5, 2.0), W(2.0, 2.5)];
    expect(activeWordIndex(words, 1.2)).toBe(2);
    expect(activeWordIndex(words, 1.8)).toBe(3);
  });

  it("sticks to the most recent finished word when t falls in a gap", () => {
    const words = [W(0, 1), W(2, 3), W(4, 5)];
    expect(activeWordIndex(words, 1.5)).toBe(0);
    expect(activeWordIndex(words, 3.5)).toBe(1);
  });

  it("returns 0 for t at the first word.start exactly", () => {
    const words = [W(0.5, 1.0), W(1.0, 1.5)];
    expect(activeWordIndex(words, 0.5)).toBe(0);
  });

  it("handles a 1000-word stress test in well under 1 ms per lookup", () => {
    const words: ActiveWord[] = [];
    for (let i = 0; i < 1000; i++) words.push(W(i * 0.3, i * 0.3 + 0.25));

    const samples = 5000;
    const t0 = performance.now();
    let acc = 0;
    for (let i = 0; i < samples; i++) {
      const t = (i / samples) * (words.length * 0.3);
      acc += activeWordIndex(words, t);
    }
    const elapsedMs = performance.now() - t0;
    const perLookupMs = elapsedMs / samples;

    expect(acc).toBeGreaterThan(0); // make sure the JIT doesn't elide
    expect(perLookupMs).toBeLessThan(1);
  });
});
