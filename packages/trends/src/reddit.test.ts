import { describe, it, expect, vi } from "vitest";
import { redditSearch } from "./reddit";

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const FIXTURE = {
  data: {
    children: [
      {
        data: {
          title: "I bought VTI and held",
          ups: 1200,
          num_comments: 80,
          subreddit: "investing",
          permalink: "/r/investing/comments/abc/i_bought_vti/",
          created_utc: 1716000000,
        },
      },
      {
        data: {
          title: "VTI vs VOO",
          ups: 300,
          num_comments: 25,
          subreddit: "investing",
          permalink: "/r/investing/comments/def/vti_vs_voo/",
          created_utc: 1716000500,
        },
      },
    ],
  },
};

describe("redditSearch", () => {
  it("parses posts across multiple subreddits", async () => {
    const fetchImpl = vi.fn(async () => mockResponse(200, FIXTURE));
    const out = await redditSearch({
      keyword: "vti",
      subreddits: ["investing", "stocks"],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxAttempts: 1,
    });
    expect(out).not.toBeNull();
    expect(out!.posts).toHaveLength(4);
    expect(out!.topUps).toBe(1200);
    expect(out!.postCount).toBe(4);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries on 429 then succeeds", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? mockResponse(429, {}) : mockResponse(200, FIXTURE);
    });
    const out = await redditSearch({
      keyword: "vti",
      subreddits: ["investing"],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxAttempts: 2,
    });
    expect(out).not.toBeNull();
    expect(out!.postCount).toBe(2);
    expect(calls).toBe(2);
  });

  it("returns null if every subreddit fails", async () => {
    const fetchImpl = vi.fn(async () => mockResponse(503, {}));
    const out = await redditSearch({
      keyword: "vti",
      subreddits: ["investing", "stocks"],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxAttempts: 1,
      logger: { warn: () => undefined },
    });
    expect(out).toBeNull();
  });

  it("sends the configured user-agent header", async () => {
    const fetchImpl = vi.fn(async () => mockResponse(200, FIXTURE));
    await redditSearch({
      keyword: "vti",
      subreddits: ["investing"],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxAttempts: 1,
      userAgent: "test-agent/9.9",
    });
    const [, opts] = fetchImpl.mock.calls[0]!;
    expect((opts as { headers: Record<string, string> }).headers["User-Agent"]).toBe("test-agent/9.9");
  });
});
