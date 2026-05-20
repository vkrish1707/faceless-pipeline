import { describe, it, expect, vi, beforeEach } from "vitest";

function mockSdk(responses: Array<{ body?: unknown; error?: Error }>) {
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
  input_tokens: 150,
  output_tokens: 60,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 50,
};

function goodBody() {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          score: 80,
          breakdown: {
            hook_strength: 23,
            specificity: 16,
            trend_alignment: 17,
            format_fit: 13,
            shelf_life: 11,
          },
          reasoning: "Polished script tightens the hook and surfaces a specific number.",
          flags: [],
        }),
      },
    ],
    usage: USAGE,
  };
}

const SCRIPT = {
  title: "Compound interest is fast",
  hook: "One dollar at 25 beats ten dollars at 45.",
  body: "Anna invests 300 a month from 25 to 35 and stops. Bob invests the same from 35 to 65. Anna ends up ahead.",
  cta: "Save this and start a transfer.",
  targetLengthSec: 30,
};

describe("rescoreScript", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns a validated score on happy path and surfaces cache-read tokens", async () => {
    mockSdk([{ body: goodBody() }]);
    const { rescoreScript } = await import("./rescore");
    const out = await rescoreScript({
      script: SCRIPT,
      chapterText: "x".repeat(2000),
      trendSummary: {},
      apiKey: "test-key",
    });
    expect(out.score).toBe(80);
    expect(out.usage.cacheReadTokens).toBe(50);
  });

  it("throws NonRetryableError on schema fail after one self-correction attempt", async () => {
    const bad = {
      content: [{ type: "text", text: JSON.stringify({ score: 80, breakdown: {} }) }],
      usage: USAGE,
    };
    mockSdk([{ body: bad }, { body: bad }]);
    const { rescoreScript } = await import("./rescore");
    await expect(
      rescoreScript({
        script: SCRIPT,
        chapterText: "x".repeat(500),
        trendSummary: {},
        apiKey: "test-key",
        maxAttempts: 2,
      })
    ).rejects.toThrow(/schema/);
  });
});
