import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../../db";
import { runJob, registerHandler, _resetHandlers } from "../runner";
import { createScoreChapterHandler } from "./score-chapter";

describe("handleScoreChapter", () => {
  let bookId: string;
  let chapterId: string;
  let ideaIds: string[] = [];

  beforeEach(async () => {
    _resetHandlers();
    await db.apiUsage.deleteMany();
    await db.suggestion.deleteMany();
    await db.idea.deleteMany();
    await db.trendSnapshot.deleteMany();
    await db.chapter.deleteMany();
    await db.book.deleteMany();
    await db.job.deleteMany();

    const book = await db.book.create({
      data: { title: "Finance Basics", filePath: "/tmp/b.pdf", niche: "investing", pageCount: 1, status: "ready" },
    });
    bookId = book.id;
    const chapter = await db.chapter.create({
      data: {
        bookId,
        title: "Chapter 1",
        orderIndex: 0,
        startPage: 0,
        endPage: 0,
        rawText: "compound interest is a powerful force in long term investing.",
        status: "extracted",
      },
    });
    chapterId = chapter.id;

    const a = await db.idea.create({
      data: {
        chapterId,
        title: "Compound interest changes everything",
        summary: "small early contributions outperform large late ones",
        targetLengthSec: 30,
        candidateHooks: ["a", "b"],
        status: "draft",
      },
    });
    const b = await db.idea.create({
      data: {
        chapterId,
        title: "Index funds beat stock picking",
        summary: "research consistently shows passive wins net of fees",
        targetLengthSec: 60,
        candidateHooks: ["a", "b"],
        status: "draft",
      },
    });
    ideaIds = [a.id, b.id];
    process.env.ANTHROPIC_API_KEY = "sk-test-1234567890123456";
  });

  function buildHandler() {
    const scoreIdea = vi.fn(async (opts: { idea: { id: string } }) => ({
      score: 78,
      breakdown: {
        hook_strength: 22,
        specificity: 14,
        trend_alignment: 16,
        format_fit: 14,
        shelf_life: 12,
      },
      reasoning: "Concrete claim with clear hook potential.",
      flags: [],
      usage: { inputTokens: 200, outputTokens: 80, cacheCreationTokens: 0, cacheReadTokens: 0 },
    }));
    const suggestForChapter = vi.fn(async () => ({
      merges: [],
      splits: [],
      drops: [
        { ideaId: ideaIds[1]!, reason: "duplicates another stronger idea in chapter" },
      ],
      series: [],
      reframes: [],
      usage: { inputTokens: 600, outputTokens: 200, cacheCreationTokens: 0, cacheReadTokens: 100 },
    }));
    const googleTrends = vi.fn(async (opts: { keyword: string }) => ({
      points: [{ date: "Mon", value: 50 }],
      avg: 50,
      direction: "flat" as const,
    }));
    const redditSearch = vi.fn(async () => ({ posts: [], topUps: 0, postCount: 0 }));

    return {
      handler: createScoreChapterHandler({
        scoreIdea: scoreIdea as never,
        suggestForChapter: suggestForChapter as never,
        googleTrends: googleTrends as never,
        redditSearch: redditSearch as never,
        scoreConcurrency: 2,
      }),
      mocks: { scoreIdea, suggestForChapter, googleTrends, redditSearch },
    };
  }

  it("scores ideas, creates suggestions, logs api usage, and persists trend snapshots", async () => {
    const { handler, mocks } = buildHandler();
    registerHandler("score_chapter", handler);

    const job = await db.job.create({
      data: { type: "score_chapter", status: "queued", targetType: "Chapter", targetId: chapterId, payload: { chapterId } },
    });
    await runJob(job.id);

    const after = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe("completed");
    expect(after.progress).toBe(100);

    const ideas = await db.idea.findMany({ where: { chapterId } });
    expect(ideas.every((i) => i.score === 78)).toBe(true);
    expect(mocks.scoreIdea).toHaveBeenCalledTimes(2);

    const suggestions = await db.suggestion.findMany({ where: { chapterId } });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.kind).toBe("drop");
    expect(suggestions[0]!.status).toBe("open");

    const snapshots = await db.trendSnapshot.findMany();
    expect(snapshots.length).toBeGreaterThan(0);

    const usage = await db.apiUsage.findMany();
    expect(usage).toHaveLength(1);
    expect(usage[0]!.endpoint).toBe("messages.create:score+suggest");
  });

  it("re-uses TrendSnapshot rows on a re-run (cache hit)", async () => {
    const { handler, mocks } = buildHandler();
    registerHandler("score_chapter", handler);

    const job1 = await db.job.create({
      data: { type: "score_chapter", status: "queued", targetType: "Chapter", targetId: chapterId, payload: { chapterId } },
    });
    await runJob(job1.id);
    const firstCallCount = mocks.googleTrends.mock.calls.length + mocks.redditSearch.mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);

    const snapshotsBefore = await db.trendSnapshot.count();

    const job2 = await db.job.create({
      data: { type: "score_chapter", status: "queued", targetType: "Chapter", targetId: chapterId, payload: { chapterId } },
    });
    await runJob(job2.id);

    const secondCallCount =
      mocks.googleTrends.mock.calls.length + mocks.redditSearch.mock.calls.length - firstCallCount;
    expect(secondCallCount).toBe(0);

    const snapshotsAfter = await db.trendSnapshot.count();
    expect(snapshotsAfter).toBe(snapshotsBefore);

    const after = await db.job.findUniqueOrThrow({ where: { id: job2.id } });
    expect(after.status).toBe("completed");
  });

  it("monotonically advances Job.progress through the four stages", async () => {
    const seen: number[] = [];
    const handler = createScoreChapterHandler({
      scoreIdea: (async () => ({
        score: 50,
        breakdown: { hook_strength: 10, specificity: 10, trend_alignment: 10, format_fit: 10, shelf_life: 10 },
        reasoning: "placeholder reasoning text",
        flags: [],
        usage: { inputTokens: 10, outputTokens: 10, cacheCreationTokens: 0, cacheReadTokens: 0 },
      })) as never,
      suggestForChapter: (async () => ({
        merges: [],
        splits: [],
        drops: [],
        series: [],
        reframes: [],
        usage: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
      })) as never,
      googleTrends: (async () => null) as never,
      redditSearch: (async () => null) as never,
    });
    registerHandler("score_chapter", async (payload, ctx) => {
      const wrap = {
        ...ctx,
        updateProgress: async (n: number) => {
          seen.push(n);
          await ctx.updateProgress(n);
        },
      };
      return handler(payload as never, wrap);
    });

    const job = await db.job.create({
      data: { type: "score_chapter", status: "queued", targetType: "Chapter", targetId: chapterId, payload: { chapterId } },
    });
    await runJob(job.id);

    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]!);
    }
    expect(seen).toContain(10);
    expect(seen).toContain(60);
    expect(seen).toContain(95);
    expect(seen[seen.length - 1]).toBe(100);
  });
});
