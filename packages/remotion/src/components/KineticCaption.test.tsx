import { describe, it, expect } from "vitest";
import { findCurrentWordIndex, KineticCaption } from "./KineticCaption";
import { financeDark } from "../theme/finance";

/**
 * We test the pure helper (`findCurrentWordIndex`) thoroughly and then
 * exercise the component as a plain function: React function components are
 * just functions of props, and the returned element tree is a serializable
 * object we can walk to assert structure. This avoids pulling in a DOM
 * renderer (jsdom) for what is, in essence, a deterministic mapping.
 */

const words = [
  { word: "alpha", start: 0.0, end: 0.5 },
  { word: "beta", start: 0.5, end: 1.0 },
  { word: "gamma", start: 1.0, end: 1.5 },
  { word: "delta", start: 1.5, end: 2.0 },
];

describe("findCurrentWordIndex", () => {
  it("returns -1 before the first word", () => {
    expect(findCurrentWordIndex(words, -0.1)).toBe(-1);
  });

  it("snaps to the current word at its start boundary", () => {
    expect(findCurrentWordIndex(words, 0.0)).toBe(0);
    expect(findCurrentWordIndex(words, 0.5)).toBe(1);
    expect(findCurrentWordIndex(words, 1.0)).toBe(2);
  });

  it("stays on the last-started word during silent gaps", () => {
    // Between gamma.end (1.5) and delta.start (1.5) — coincident here, but
    // also test a real gap by picking a time inside a word.
    expect(findCurrentWordIndex(words, 0.4)).toBe(0);
    expect(findCurrentWordIndex(words, 0.9)).toBe(1);
  });

  it("returns last index past the final word", () => {
    expect(findCurrentWordIndex(words, 5.0)).toBe(3);
  });

  it("returns -1 for empty caption array", () => {
    expect(findCurrentWordIndex([], 0)).toBe(-1);
  });
});

describe("KineticCaption", () => {
  function getWordSpans(tree: any): any[] {
    // tree.props.children is the rendered spans array
    const children = tree.props?.children;
    if (Array.isArray(children)) return children.flat().filter(Boolean);
    return children ? [children] : [];
  }

  it("renders nothing before any word has started", () => {
    const tree = KineticCaption({
      captions: { words },
      frame: -1,
      fps: 30,
      theme: financeDark,
    });
    expect(tree).toBeNull();
  });

  it("highlights exactly one word at the current frame", () => {
    // At t=0.5s (frame 15) → beta should be current.
    const tree: any = KineticCaption({
      captions: { words },
      frame: 15,
      fps: 30,
      theme: financeDark,
    });
    expect(tree).not.toBeNull();
    const spans = getWordSpans(tree);
    const current = spans.filter((s) => s.props["data-current"] === "true");
    expect(current).toHaveLength(1);
    expect(current[0].props["data-word"]).toBe("beta");
  });

  it("colors the current word with theme.textHighlight and pulses scale", () => {
    const tree: any = KineticCaption({
      captions: { words },
      frame: 30, // t=1.0s → gamma is current, its start frame is 30
      fps: 30,
      theme: financeDark,
    });
    const spans = getWordSpans(tree);
    const gamma = spans.find((s) => s.props["data-word"] === "gamma");
    expect(gamma).toBeDefined();
    expect(gamma.props.style.color).toBe(financeDark.textHighlight);
    // At exact start frame, the centered pulse interpolation reaches its peak.
    expect(gamma.props.style.transform).toMatch(/scale\(1.1\)/);
  });

  it("non-current words use textPrimary and scale=1", () => {
    const tree: any = KineticCaption({
      captions: { words },
      frame: 30,
      fps: 30,
      theme: financeDark,
    });
    const spans = getWordSpans(tree);
    const beta = spans.find((s) => s.props["data-word"] === "beta");
    expect(beta.props.style.color).toBe(financeDark.textPrimary);
    expect(beta.props.style.transform).toBe("scale(1)");
  });

  it("only shows a sliding window of words around the current one", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      word: `w${i}`,
      start: i * 0.5,
      end: (i + 1) * 0.5,
    }));
    // current at i=5
    const tree: any = KineticCaption({
      captions: { words: many },
      frame: 5 * 0.5 * 30,
      fps: 30,
      theme: financeDark,
      windowRadius: 1,
    });
    const spans = getWordSpans(tree);
    // 1 before + current + 1 after = 3
    expect(spans).toHaveLength(3);
    expect(spans.map((s) => s.props["data-word"])).toEqual(["w4", "w5", "w6"]);
  });
});
