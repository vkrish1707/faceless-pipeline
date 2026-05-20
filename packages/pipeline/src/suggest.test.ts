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
  input_tokens: 600,
  output_tokens: 300,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

const IDEAS = [
  { id: "a", title: "Compound interest is fast", summary: "small early > large late.", score: 80, breakdown: null },
  { id: "b", title: "Compound interest doubles money", summary: "doubling time concept", score: 78, breakdown: null },
  { id: "c", title: "Stock picking is overrated", summary: "index beats picks", score: 60, breakdown: null },
];

describe("suggestForChapter", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("parses a merge suggestion on happy path", async () => {
    mockSdk([
      {
        body: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                merges: [
                  {
                    ideaIds: ["a", "b"],
                    combinedTitle: "Compound interest doubles money fast",
                    reason: "same underlying claim",
                  },
                ],
                splits: [],
                drops: [],
                series: [],
                reframes: [],
              }),
            },
          ],
          usage: USAGE,
        },
      },
    ]);
    const { suggestForChapter } = await import("./suggest");
    const out = await suggestForChapter({
      chapterText: "x".repeat(500),
      ideas: IDEAS,
      trendSummary: {},
      apiKey: "test-key",
    });
    expect(out.merges).toHaveLength(1);
    expect(out.merges[0]!.ideaIds).toEqual(["a", "b"]);
    expect(out.splits).toEqual([]);
  });

  it("accepts an empty response", async () => {
    mockSdk([
      {
        body: {
          content: [{ type: "text", text: JSON.stringify({}) }],
          usage: USAGE,
        },
      },
    ]);
    const { suggestForChapter } = await import("./suggest");
    const out = await suggestForChapter({
      chapterText: "x".repeat(500),
      ideas: IDEAS,
      trendSummary: {},
      apiKey: "test-key",
    });
    expect(out.merges).toEqual([]);
    expect(out.splits).toEqual([]);
    expect(out.drops).toEqual([]);
  });

  it("filters out suggestions that reference unknown idea ids", async () => {
    mockSdk([
      {
        body: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                merges: [
                  { ideaIds: ["a", "zzz"], combinedTitle: "bogus", reason: "references unknown id" },
                ],
                drops: [{ ideaId: "c", reason: "weak hook, off-niche, dupe" }],
              }),
            },
          ],
          usage: USAGE,
        },
      },
    ]);
    const { suggestForChapter } = await import("./suggest");
    const out = await suggestForChapter({
      chapterText: "x".repeat(500),
      ideas: IDEAS,
      trendSummary: {},
      apiKey: "test-key",
    });
    expect(out.merges).toEqual([]);
    expect(out.drops).toHaveLength(1);
    expect(out.drops[0]!.ideaId).toBe("c");
  });
});
