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
  input_tokens: 800,
  output_tokens: 400,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

const VALID_SCRIPT = {
  hook: "One dollar at 25 beats ten dollars at 45.",
  body: "Compound interest is the eighth wonder of the world. Anna invests 300 dollars a month from 25 to 35 and stops. Bob invests the same from 35 to 65. Anna ends up ahead despite contributing for only ten years.",
  cta: "Save this and start your monthly transfer.",
  visualBeats: [
    { start: 0, end: 3, keywords: ["clock", "money"], mediaType: "video", tone: "urgent" },
    { start: 3, end: 25, keywords: ["chart", "growth"], mediaType: "video", tone: "explainer" },
    { start: 25, end: 30, keywords: ["wallet"], mediaType: "photo", tone: "payoff" },
  ],
  metadata: {
    youtubeTitle: "Why Anna beats Bob with less money",
    caption: "Time, not amount, is the lever. Here's the math.",
    hashtags: ["#investing", "#compoundinterest", "#money"],
    thumbnailConcept: "Two stick figures with money bags, Anna's bag glowing.",
  },
};

const IDEA = {
  title: "Compound interest is unforgivingly fast",
  summary: "Small early contributions outperform large late ones.",
  targetLengthSec: 30,
  sourceQuotes: ["compound interest is the eighth wonder of the world"],
  candidateHooks: ["One dollar at 25 beats ten dollars at 45.", "Your future self begs you to start."],
};

describe("generateScript", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns a validated script + usage on happy path", async () => {
    mockSdk([{ body: { content: [{ type: "text", text: JSON.stringify(VALID_SCRIPT) }], usage: USAGE } }]);
    const { generateScript } = await import("./script");
    const out = await generateScript({
      idea: IDEA,
      chapterText: "x".repeat(1000),
      niche: "investing",
      apiKey: "test-key",
    });
    expect(out.script.hook).toMatch(/dollar/);
    expect(out.script.visualBeats).toHaveLength(3);
    expect(out.usage.inputTokens).toBe(800);
  });

  it("retries on 429 then succeeds", async () => {
    const err = Object.assign(new Error("rate"), { status: 429 });
    const fn = mockSdk([
      { error: err },
      { body: { content: [{ type: "text", text: JSON.stringify(VALID_SCRIPT) }], usage: USAGE } },
    ]);
    const { generateScript } = await import("./script");
    const out = await generateScript({
      idea: IDEA,
      chapterText: "x".repeat(1000),
      niche: "investing",
      apiKey: "test-key",
    });
    expect(out.script.hook).toMatch(/dollar/);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("self-corrects once on beat overlap then succeeds", async () => {
    const overlapping = {
      ...VALID_SCRIPT,
      visualBeats: [
        { start: 0, end: 10, keywords: ["a"], mediaType: "video", tone: "urgent" },
        { start: 5, end: 30, keywords: ["b"], mediaType: "video", tone: "explainer" },
      ],
    };
    const fn = mockSdk([
      { body: { content: [{ type: "text", text: JSON.stringify(overlapping) }], usage: USAGE } },
      { body: { content: [{ type: "text", text: JSON.stringify(VALID_SCRIPT) }], usage: USAGE } },
    ]);
    const { generateScript } = await import("./script");
    const out = await generateScript({
      idea: IDEA,
      chapterText: "x".repeat(1000),
      niche: "investing",
      apiKey: "test-key",
    });
    expect(out.script.visualBeats).toHaveLength(3);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("dedupes hashtags case-insensitively preserving first occurrence", async () => {
    const withDupes = {
      ...VALID_SCRIPT,
      metadata: {
        ...VALID_SCRIPT.metadata,
        hashtags: ["#Money", "#money", "#INVESTING", "#fyp"],
      },
    };
    mockSdk([{ body: { content: [{ type: "text", text: JSON.stringify(withDupes) }], usage: USAGE } }]);
    const { generateScript } = await import("./script");
    const out = await generateScript({
      idea: IDEA,
      chapterText: "x".repeat(500),
      niche: "investing",
      apiKey: "test-key",
    });
    expect(out.script.metadata.hashtags).toEqual(["#Money", "#INVESTING", "#fyp"]);
  });

  it("throws after schema retries exhaust", async () => {
    const bad = { hook: "x", body: "y", cta: "z", visualBeats: [], metadata: {} };
    mockSdk([
      { body: { content: [{ type: "text", text: JSON.stringify(bad) }], usage: USAGE } },
      { body: { content: [{ type: "text", text: JSON.stringify(bad) }], usage: USAGE } },
    ]);
    const { generateScript } = await import("./script");
    await expect(
      generateScript({
        idea: IDEA,
        chapterText: "x".repeat(500),
        niche: "investing",
        apiKey: "test-key",
        maxAttempts: 2,
      })
    ).rejects.toThrow(/schema/);
  });
});
