import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../../db";
import { runJob, registerHandler, _resetHandlers } from "../runner";
import { createRescoreScriptHandler } from "./rescore-script";

describe("handleRescoreScript", () => {
  let scriptId: string;

  beforeEach(async () => {
    _resetHandlers();
    await db.apiUsage.deleteMany();
    await db.render.deleteMany();
    await db.script.deleteMany();
    await db.suggestion.deleteMany();
    await db.idea.deleteMany();
    await db.chapter.deleteMany();
    await db.book.deleteMany();
    await db.job.deleteMany();

    const book = await db.book.create({
      data: { title: "F", filePath: "/tmp/x.pdf", niche: "investing", pageCount: 1, status: "ready" },
    });
    const chapter = await db.chapter.create({
      data: {
        bookId: book.id,
        title: "C1",
        orderIndex: 0,
        startPage: 0,
        endPage: 0,
        rawText: "compound text",
        status: "extracted",
      },
    });
    const idea = await db.idea.create({
      data: {
        chapterId: chapter.id,
        title: "Compound interest is fast",
        summary: "x",
        targetLengthSec: 30,
        status: "scripted",
      },
    });
    const script = await db.script.create({
      data: {
        ideaId: idea.id,
        hook: "edited hook",
        body: "edited body content longer than fifty chars by quite a lot to satisfy validators",
        cta: "save this for later",
        visualBeats: [],
        metadata: {},
        status: "draft",
        generatedAt: new Date(),
      },
    });
    scriptId = script.id;
    process.env.ANTHROPIC_API_KEY = "sk-test-1234567890123456";
  });

  it("updates Script.score + scoreBreakdown and logs ApiUsage", async () => {
    const rescore = vi.fn(async () => ({
      score: 82,
      breakdown: { hook_strength: 24, specificity: 15, trend_alignment: 18, format_fit: 13, shelf_life: 12 },
      reasoning: "tighter hook surfaces a number up front",
      flags: [],
      usage: { inputTokens: 150, outputTokens: 60, cacheCreationTokens: 0, cacheReadTokens: 100 },
    }));
    const handler = createRescoreScriptHandler({ rescoreScript: rescore as never });
    registerHandler("rescore_script", handler);

    const job = await db.job.create({
      data: {
        type: "rescore_script",
        status: "queued",
        targetType: "Script",
        targetId: scriptId,
        payload: { scriptId },
      },
    });
    await runJob(job.id);

    const after = await db.script.findUniqueOrThrow({ where: { id: scriptId } });
    expect(after.score).toBe(82);
    const bd = after.scoreBreakdown as { hook_strength: number };
    expect(bd.hook_strength).toBe(24);

    const usage = await db.apiUsage.findFirst();
    expect(usage?.endpoint).toBe("messages.create:rescore_script");
    expect(usage?.cacheTokensRead).toBe(100);
  });
});
