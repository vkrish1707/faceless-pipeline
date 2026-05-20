import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../../db";
import { runJob, registerHandler, _resetHandlers } from "../runner";
import { createGenerateScriptHandler } from "./generate-script";

const VALID_SCRIPT = {
  hook: "One single dollar at twenty-five beats ten dollars at forty-five flat.",
  body: "Compound interest is the eighth wonder of the world according to many. Anna invests three hundred dollars a month from twenty-five to thirty-five and stops. Bob invests the same amount from thirty-five to sixty-five and never stops. Anna ends up ahead despite contributing for only ten years total because her early dollars have more years to double.",
  cta: "Save this clip for later and start a monthly transfer today.",
  visualBeats: [
    { start: 0, end: 3, keywords: ["clock"], mediaType: "video", tone: "urgent" },
    { start: 3, end: 25, keywords: ["chart"], mediaType: "video", tone: "explainer" },
    { start: 25, end: 30, keywords: ["wallet"], mediaType: "photo", tone: "payoff" },
  ],
  metadata: {
    youtubeTitle: "Why Anna beats Bob",
    caption: "Time is the lever. Here's the math.",
    hashtags: ["#investing", "#money"],
    thumbnailConcept: "Two stick figures, one glowing money bag.",
  },
};

describe("handleGenerateScript", () => {
  let ideaId: string;

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
        rawText: "compound interest etc.",
        status: "extracted",
      },
    });
    const idea = await db.idea.create({
      data: {
        chapterId: chapter.id,
        title: "Compound interest is fast",
        summary: "small early beats large late",
        targetLengthSec: 30,
        candidateHooks: ["hook a here please", "hook b alternative"],
        sourceQuotes: ["compound interest"],
        status: "approved",
      },
    });
    ideaId = idea.id;
    process.env.ANTHROPIC_API_KEY = "sk-test-1234567890123456";
  });

  it("persists Script + flips Idea.status='scripted' + logs ApiUsage", async () => {
    const generate = vi.fn(async () => ({
      script: VALID_SCRIPT,
      usage: { inputTokens: 800, outputTokens: 400, cacheCreationTokens: 0, cacheReadTokens: 50 },
    }));
    const handler = createGenerateScriptHandler({ generateScript: generate as never });
    registerHandler("generate_script", handler);

    const job = await db.job.create({
      data: {
        type: "generate_script",
        status: "queued",
        targetType: "Idea",
        targetId: ideaId,
        payload: { ideaId },
      },
    });
    await runJob(job.id);

    const after = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe("completed");
    expect(after.progress).toBe(100);

    const script = await db.script.findUniqueOrThrow({ where: { ideaId } });
    expect(script.hook).toMatch(/dollar/);
    expect(script.warnings).toBeNull();
    expect(script.generatedAt).not.toBeNull();

    const idea = await db.idea.findUniqueOrThrow({ where: { id: ideaId } });
    expect(idea.status).toBe("scripted");

    const usage = await db.apiUsage.findMany();
    expect(usage).toHaveLength(1);
    expect(usage[0]!.endpoint).toBe("messages.create:generate_script");
    expect(usage[0]!.cacheTokensRead).toBe(50);
  });

  it("overwrites an existing Script row on re-generate", async () => {
    await db.script.create({
      data: {
        ideaId,
        hook: "old hook",
        body: "old body",
        cta: "old cta",
        visualBeats: [],
        metadata: {},
        status: "draft",
      },
    });
    const generate = vi.fn(async () => ({
      script: VALID_SCRIPT,
      usage: { inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0 },
    }));
    const handler = createGenerateScriptHandler({ generateScript: generate as never });
    registerHandler("generate_script", handler);

    const job = await db.job.create({
      data: { type: "generate_script", status: "queued", targetType: "Idea", targetId: ideaId, payload: { ideaId } },
    });
    await runJob(job.id);

    const scripts = await db.script.findMany({ where: { ideaId } });
    expect(scripts).toHaveLength(1);
    expect(scripts[0]!.hook).toMatch(/dollar/);
  });

  it("persists warnings when the generated script trips a soft check", async () => {
    const shortBeats = {
      ...VALID_SCRIPT,
      visualBeats: [
        { start: 0, end: 3, keywords: ["a"], mediaType: "video", tone: "urgent" },
        { start: 3, end: 10, keywords: ["b"], mediaType: "video", tone: "explainer" },
      ],
    };
    const generate = vi.fn(async () => ({
      script: shortBeats,
      usage: { inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0 },
    }));
    const handler = createGenerateScriptHandler({ generateScript: generate as never });
    registerHandler("generate_script", handler);

    const job = await db.job.create({
      data: { type: "generate_script", status: "queued", targetType: "Idea", targetId: ideaId, payload: { ideaId } },
    });
    await runJob(job.id);

    const script = await db.script.findUniqueOrThrow({ where: { ideaId } });
    const warnings = script.warnings as Array<{ kind: string }> | null;
    expect(warnings).not.toBeNull();
    expect(warnings!.some((w) => w.kind === "beat_coverage")).toBe(true);
  });
});
