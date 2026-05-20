import { describe, it, expect, vi, beforeEach } from "vitest";

function mockSdk(responses: Array<{ status?: number; body?: unknown; error?: Error }>) {
  const createMock = vi.fn();
  for (const r of responses) {
    if (r.error) createMock.mockRejectedValueOnce(r.error);
    else createMock.mockResolvedValueOnce(r.body);
  }
  vi.doMock("@anthropic-ai/sdk", () => {
    return {
      default: class {
        messages = { create: createMock };
      },
    };
  });
  return createMock;
}

const USAGE = {
  input_tokens: 200,
  output_tokens: 80,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

function goodBody() {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          score: 76,
          breakdown: {
            hook_strength: 22,
            specificity: 14,
            trend_alignment: 18,
            format_fit: 12,
            shelf_life: 10,
          },
          reasoning: "Strong concrete numbers and rising trend signal.",
          flags: ["trend-rising"],
        }),
      },
    ],
    usage: USAGE,
  };
}

const IDEA = {
  id: "idea-1",
  title: "Compound interest is fast",
  summary: "Small early contributions outperform large late ones because of doubling time.",
  targetLengthSec: 30,
  candidateHooks: ["Your future self begs you to start.", "$1 at 25 beats $10 at 45."],
};

describe("scoreIdea", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns a validated score on happy path", async () => {
    mockSdk([{ body: goodBody() }]);
    const { scoreIdea } = await import("./score");
    const out = await scoreIdea({
      idea: IDEA,
      chapterText: "x".repeat(1000),
      trendSummaryForIdea: { google: { avg: 70, dir: "rising" } },
      apiKey: "test-key",
    });
    expect(out.score).toBe(76);
    expect(out.breakdown.hook_strength).toBe(22);
    expect(out.usage.inputTokens).toBe(200);
  });

  it("retries on 429 then succeeds", async () => {
    const err = Object.assign(new Error("rate limit"), { status: 429 });
    const fn = mockSdk([{ error: err }, { body: goodBody() }]);
    const { scoreIdea } = await import("./score");
    const out = await scoreIdea({
      idea: IDEA,
      chapterText: "x".repeat(1000),
      trendSummaryForIdea: {},
      apiKey: "test-key",
    });
    expect(out.score).toBe(76);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("self-corrects once when sum mismatch occurs, then succeeds", async () => {
    const badBody = {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            score: 90, // does not match breakdown sum (76)
            breakdown: {
              hook_strength: 22,
              specificity: 14,
              trend_alignment: 18,
              format_fit: 12,
              shelf_life: 10,
            },
            reasoning: "sum-mismatch placeholder reasoning",
            flags: [],
          }),
        },
      ],
      usage: USAGE,
    };
    const fn = mockSdk([{ body: badBody }, { body: goodBody() }]);
    const { scoreIdea } = await import("./score");
    const out = await scoreIdea({
      idea: IDEA,
      chapterText: "x".repeat(1000),
      trendSummaryForIdea: {},
      apiKey: "test-key",
    });
    expect(out.score).toBe(76);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws NonRetryableError after one self-correction fails sum-check again", async () => {
    const badBody = {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            score: 88,
            breakdown: {
              hook_strength: 22,
              specificity: 14,
              trend_alignment: 18,
              format_fit: 12,
              shelf_life: 10,
            },
            reasoning: "sum-mismatch placeholder reasoning",
            flags: [],
          }),
        },
      ],
      usage: USAGE,
    };
    mockSdk([{ body: badBody }, { body: badBody }]);
    const { scoreIdea } = await import("./score");
    await expect(
      scoreIdea({
        idea: IDEA,
        chapterText: "x".repeat(1000),
        trendSummaryForIdea: {},
        apiKey: "test-key",
        maxAttempts: 2,
      })
    ).rejects.toThrow(/sum mismatch/);
  });
});
