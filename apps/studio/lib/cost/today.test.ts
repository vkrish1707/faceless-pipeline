import { describe, it, expect } from "vitest";
import { summarizeUsage, rowCostUsd } from "./today";

const NOW = new Date("2026-05-21T12:00:00Z");
const todayMorning = new Date("2026-05-21T03:00:00Z");
const yesterday = new Date("2026-05-20T03:00:00Z");

describe("rowCostUsd", () => {
  it("honours explicit costUsd when present", () => {
    expect(rowCostUsd({ service: "anthropic", endpoint: "x", costUsd: 0.42, createdAt: NOW })).toBe(0.42);
  });

  it("computes from Sonnet token counts when costUsd is null", () => {
    // 1M in tokens @ $3 + 1M out tokens @ $15 = $18
    const c = rowCostUsd({
      service: "anthropic",
      endpoint: "claude-sonnet-4-7-messages",
      tokensIn: 1_000_000,
      tokensOut: 1_000_000,
      createdAt: NOW,
    });
    expect(c).toBeCloseTo(18, 4);
  });

  it("computes from Haiku rates when endpoint includes 'haiku'", () => {
    const c = rowCostUsd({
      service: "anthropic",
      endpoint: "claude-haiku-4-7-messages",
      tokensIn: 1_000_000,
      tokensOut: 1_000_000,
      createdAt: NOW,
    });
    // 1M in @ $1 + 1M out @ $5 = $6
    expect(c).toBeCloseTo(6, 4);
  });

  it("treats non-anthropic services as $0 unless costUsd is explicit", () => {
    expect(rowCostUsd({ service: "pexels", endpoint: "search", createdAt: NOW })).toBe(0);
    expect(rowCostUsd({ service: "remotion", endpoint: "render", createdAt: NOW })).toBe(0);
  });
});

describe("summarizeUsage", () => {
  it("only counts today's rows in todayUsd", () => {
    const out = summarizeUsage({
      now: NOW,
      rows: [
        { service: "anthropic", endpoint: "x", costUsd: 1, createdAt: todayMorning },
        { service: "anthropic", endpoint: "x", costUsd: 2, createdAt: yesterday },
      ],
    });
    expect(out.todayUsd).toBe(1);
    expect(out.traceCount).toBe(2);
  });

  it("bookUsd is 0 when no bookTraceIds is provided", () => {
    const out = summarizeUsage({
      now: NOW,
      rows: [{ service: "anthropic", endpoint: "x", costUsd: 1.5, createdAt: todayMorning }],
    });
    expect(out.bookUsd).toBe(0);
  });

  it("bookUsd is the sum of rows whose traceId is in the supplied set", () => {
    const out = summarizeUsage({
      now: NOW,
      bookTraceIds: new Set(["job-1", "job-2"]),
      rows: [
        { service: "anthropic", endpoint: "x", costUsd: 1, createdAt: yesterday, traceId: "job-1" },
        { service: "anthropic", endpoint: "x", costUsd: 2, createdAt: yesterday, traceId: "job-3" },
        { service: "anthropic", endpoint: "x", costUsd: 4, createdAt: yesterday, traceId: "job-2" },
      ],
    });
    expect(out.bookUsd).toBe(5);
    expect(out.todayUsd).toBe(0);
  });

  it("rounds totals to 4 decimal places", () => {
    const out = summarizeUsage({
      now: NOW,
      rows: [
        { service: "anthropic", endpoint: "claude-haiku-4-7", tokensIn: 1, tokensOut: 0, createdAt: todayMorning },
      ],
    });
    expect(Number.isInteger(out.todayUsd * 10_000)).toBe(true);
  });
});
