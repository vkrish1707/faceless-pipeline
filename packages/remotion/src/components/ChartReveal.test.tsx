import { describe, it, expect } from "vitest";
import { StatReveal, BarReveal, LineReveal } from "./ChartReveal";
import { financeDark } from "../theme/finance";

/**
 * ChartReveal is a thin router over `StatReveal`/`BarReveal`/`LineReveal`. We
 * test the leaves directly: React function components are just functions of
 * props, and the returned element tree is a serializable object we can walk
 * to assert structure — no DOM renderer needed.
 */

type Node = { type: any; props: any };

function flatten(node: Node | Node[] | string | null | undefined): Node[] {
  if (node == null) return [];
  if (typeof node === "string") return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const out: Node[] = [node];
  const children = (node as Node).props?.children;
  if (children) out.push(...flatten(children));
  return out;
}

describe("StatReveal", () => {
  it("renders bigNumber + label as <text>", () => {
    const tree = StatReveal({
      spec: { kind: "stat", label: "yearly growth", bigNumber: "8%" },
      frame: 12,
      theme: financeDark,
    }) as any;
    const nodes = flatten(tree);
    const texts = nodes.filter((n) => n.type === "text");
    expect(texts).toHaveLength(2);
    const stringChildren = texts.map((t) => String(t.props.children));
    expect(stringChildren).toContain("8%");
    expect(stringChildren).toContain("yearly growth");
  });

  it("opacity ramps 0 → 1 over the reveal window", () => {
    function statOpacity(frame: number): number {
      const tree = StatReveal({
        spec: { kind: "stat", label: "x", bigNumber: "1" },
        frame,
        theme: financeDark,
      }) as any;
      const g = flatten(tree).find(
        (n) => n.type === "g" && n.props["data-variant"] === "stat"
      );
      return Number(g!.props.opacity);
    }
    expect(statOpacity(0)).toBe(0);
    expect(statOpacity(12)).toBe(1);
    expect(statOpacity(24)).toBe(1);
  });
});

describe("BarReveal", () => {
  it("renders N <rect> + N value <text> + 1 label", () => {
    const tree = BarReveal({
      spec: { kind: "bar", label: "by decade", data: [10, 25, 60] },
      frame: 60,
      theme: financeDark,
    }) as any;
    const nodes = flatten(tree);
    const rects = nodes.filter((n) => n.type === "rect");
    expect(rects).toHaveLength(3);
    const texts = nodes.filter((n) => n.type === "text");
    // 3 per-bar value labels + 1 top label
    expect(texts.length).toBeGreaterThanOrEqual(4);
    expect(
      texts.some((t) => String(t.props.children) === "by decade")
    ).toBe(true);
  });

  it("clamps to the first 4 data points", () => {
    const tree = BarReveal({
      spec: { kind: "bar", label: "x", data: [1, 2, 3, 4, 5, 6] },
      frame: 60,
      theme: financeDark,
    }) as any;
    const rects = flatten(tree).filter((n) => n.type === "rect");
    expect(rects).toHaveLength(4);
  });

  it("bar height grows from 0 at frame 0 to >0 after the grow window", () => {
    const start = BarReveal({
      spec: { kind: "bar", label: "x", data: [10] },
      frame: 0,
      theme: financeDark,
    }) as any;
    const end = BarReveal({
      spec: { kind: "bar", label: "x", data: [10] },
      frame: 100,
      theme: financeDark,
    }) as any;
    const startRects = flatten(start).filter((n) => n.type === "rect");
    const endRects = flatten(end).filter((n) => n.type === "rect");
    expect(startRects[0]!.props.height).toBeLessThan(1);
    expect(endRects[0]!.props.height).toBeGreaterThan(0);
  });
});

describe("LineReveal", () => {
  it("renders exactly one <path> with strokeDasharray for line-draw reveal", () => {
    const tree = LineReveal({
      spec: { kind: "line", label: "growth", data: [1, 4, 9, 16] },
      frame: 24,
      theme: financeDark,
    }) as any;
    const nodes = flatten(tree);
    const paths = nodes.filter((n) => n.type === "path");
    expect(paths).toHaveLength(1);
    expect(paths[0]!.props.d).toMatch(/^M/);
    expect(paths[0]!.props.strokeDasharray).toBeDefined();
  });
});
