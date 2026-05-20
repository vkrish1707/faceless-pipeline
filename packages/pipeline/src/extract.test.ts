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

const GOOD_RESPONSE = {
  content: [
    {
      type: "text",
      text: JSON.stringify({
        ideas: [
          {
            title: "Compound interest is unforgivingly fast",
            summary: "Small early contributions outperform large late ones because of doubling time.",
            targetLengthSec: 30,
            sourceQuotes: ["compound interest is the eighth wonder of the world"],
            candidateHooks: ["Your future self begs you to start now.", "One dollar at 25 beats ten at 45."],
          },
        ],
      }),
    },
  ],
  usage: { input_tokens: 1500, output_tokens: 200, cache_creation_input_tokens: 1200, cache_read_input_tokens: 0 },
};

describe("extractIdeas", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns parsed ideas + usage on happy path", async () => {
    mockSdk([{ body: GOOD_RESPONSE }]);
    const { extractIdeas } = await import("./extract");
    const result = await extractIdeas({
      chapterText: "a".repeat(2000),
      apiKey: "test-key",
    });
    expect(result.ideas).toHaveLength(1);
    expect(result.ideas[0]!.title).toMatch(/compound/i);
    expect(result.usage.inputTokens).toBe(1500);
    expect(result.usage.cacheCreationTokens).toBe(1200);
  });

  it("retries on 429 then succeeds", async () => {
    const err = Object.assign(new Error("rate limit"), { status: 429 });
    const createMock = mockSdk([{ error: err }, { body: GOOD_RESPONSE }]);
    const { extractIdeas } = await import("./extract");
    const result = await extractIdeas({
      chapterText: "a".repeat(2000),
      apiKey: "test-key",
    });
    expect(result.ideas).toHaveLength(1);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("throws after 3 attempts on persistent 5xx", async () => {
    const err = Object.assign(new Error("server error"), { status: 503 });
    mockSdk([{ error: err }, { error: err }, { error: err }]);
    const { extractIdeas } = await import("./extract");
    await expect(
      extractIdeas({ chapterText: "a".repeat(2000), apiKey: "test-key" })
    ).rejects.toThrow();
  });

  it("throws on malformed JSON in Claude response", async () => {
    mockSdk([
      {
        body: {
          content: [{ type: "text", text: "not json at all" }],
          usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
      { body: { content: [{ type: "text", text: "still not json" }], usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
      { body: { content: [{ type: "text", text: "nope" }], usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
    ]);
    const { extractIdeas } = await import("./extract");
    await expect(
      extractIdeas({ chapterText: "a".repeat(2000), apiKey: "test-key" })
    ).rejects.toThrow();
  });
});
