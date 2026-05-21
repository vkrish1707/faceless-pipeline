import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../../db";

// Mock the pipeline so the handler test runs without hitting the network.
vi.mock("@studio/pipeline", () => ({
  extractIdeas: vi.fn(async () => ({
    ideas: [
      {
        title: "Time in the market beats timing the market",
        summary: "Lump-sum data shows holding outperforms trying to time entry points.",
        targetLengthSec: 60,
        sourceQuotes: ["time in the market beats timing the market"],
        candidateHooks: ["Your portfolio's worst enemy is your reflexes.", "The market rewards stillness."],
      },
    ],
    usage: { inputTokens: 1500, outputTokens: 120, cacheCreationTokens: 1200, cacheReadTokens: 0 },
  })),
}));

import { runJob, registerHandler } from "../runner";
import { handleExtractIdeas } from "./extract-ideas";

registerHandler("extract_ideas", handleExtractIdeas);

describe("handleExtractIdeas", () => {
  let bookId: string;
  let chapterId: string;

  beforeEach(async () => {
    await db.apiUsage.deleteMany();
    await db.pexelsCache.deleteMany();
    await db.asset.deleteMany();
    await db.render.deleteMany();
    await db.script.deleteMany();
    await db.suggestion.deleteMany();
    await db.idea.deleteMany();
    await db.chapter.deleteMany();
    await db.book.deleteMany();
    await db.job.deleteMany();
    const book = await db.book.create({
      data: { title: "Test", filePath: "/tmp/x.pdf", niche: "investing", pageCount: 1, status: "ready" },
    });
    bookId = book.id;
    const chapter = await db.chapter.create({
      data: {
        bookId,
        title: "Chapter 1",
        orderIndex: 0,
        startPage: 0,
        endPage: 0,
        rawText: "time in the market beats timing the market and other wisdom.",
        status: "pending",
      },
    });
    chapterId = chapter.id;
    process.env.ANTHROPIC_API_KEY = "sk-test-1234567890123456";
  });

  it("persists ideas and ApiUsage when run", async () => {
    const job = await db.job.create({
      data: {
        type: "extract_ideas",
        status: "queued",
        targetType: "Chapter",
        targetId: chapterId,
        payload: { chapterId },
      },
    });
    await runJob(job.id);

    const after = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe("completed");

    const ideas = await db.idea.findMany({ where: { chapterId } });
    expect(ideas).toHaveLength(1);
    expect(ideas[0]!.title).toMatch(/timing the market/);
    expect(ideas[0]!.targetLengthSec).toBe(60);

    const usage = await db.apiUsage.findMany();
    expect(usage).toHaveLength(1);
    expect(usage[0]!.tokensIn).toBe(1500);
    expect(usage[0]!.cacheTokensCreated).toBe(1200);
    expect(usage[0]!.cacheTokensRead).toBe(0);
  });

  it("replaces existing ideas for the chapter on re-run", async () => {
    await db.idea.create({
      data: {
        chapterId,
        title: "old idea",
        summary: "old",
        targetLengthSec: 15,
        status: "draft",
      },
    });

    const job = await db.job.create({
      data: {
        type: "extract_ideas",
        status: "queued",
        targetType: "Chapter",
        targetId: chapterId,
        payload: { chapterId },
      },
    });
    await runJob(job.id);

    const ideas = await db.idea.findMany({ where: { chapterId } });
    expect(ideas).toHaveLength(1);
    expect(ideas[0]!.title).not.toBe("old idea");
  });
});
