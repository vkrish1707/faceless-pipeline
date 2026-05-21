import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/jobs", async () => ({
  ensureHandlersRegistered: () => undefined,
  enqueueAndRun: vi.fn(),
}));

import { POST } from "./route";
import { db } from "../../../../lib/db";

async function clear() {
  await db.apiUsage.deleteMany();
  await db.pexelsCache.deleteMany();
  await db.asset.deleteMany();
  await db.render.deleteMany();
  await db.script.deleteMany();
  await db.suggestion.deleteMany();
  await db.idea.deleteMany();
  await db.trendSnapshot.deleteMany();
  await db.chapter.deleteMany();
  await db.book.deleteMany();
  await db.job.deleteMany();
  await db.setting.deleteMany();
}

async function seedChapter(opts: {
  approvedReady: number;
  approvedMissingPicks: number;
  notApproved: number;
}) {
  const book = await db.book.create({
    data: { title: "Book", filePath: "/tmp/b.pdf", niche: "i", pageCount: 1, status: "ready" },
  });
  const chapter = await db.chapter.create({
    data: { bookId: book.id, title: "Ch", orderIndex: 0, startPage: 0, endPage: 0, rawText: "x", status: "extracted" },
  });
  const photoAsset = await db.asset.create({
    data: { type: "pexels_photo", localPath: "/tmp/x.jpg", width: 1080, height: 1920 },
  });
  const scripts: string[] = [];
  for (let i = 0; i < opts.approvedReady; i++) {
    const idea = await db.idea.create({
      data: { chapterId: chapter.id, title: `r${i}`, summary: "s", targetLengthSec: 12, status: "scripted" },
    });
    const script = await db.script.create({
      data: {
        ideaId: idea.id,
        hook: "h",
        body: "b",
        cta: "c",
        visualBeats: [
          { start: 0, end: 6, mediaType: "photo", tone: "urgent", pickedAssetId: photoAsset.id },
        ],
        metadata: {},
        status: "approved",
      },
    });
    await db.render.create({
      data: {
        scriptId: script.id,
        audioPath: "/tmp/audio.wav",
        captionsPath: "/tmp/captions.json",
        durationSec: 12,
        fileSizeMB: 0.5,
        status: "done",
        progress: 100,
      },
    });
    scripts.push(script.id);
  }
  for (let i = 0; i < opts.approvedMissingPicks; i++) {
    const idea = await db.idea.create({
      data: { chapterId: chapter.id, title: `nopick${i}`, summary: "s", targetLengthSec: 12, status: "scripted" },
    });
    const script = await db.script.create({
      data: {
        ideaId: idea.id,
        hook: "h",
        body: "b",
        cta: "c",
        visualBeats: [
          { start: 0, end: 6, mediaType: "photo", tone: "urgent", pickedAssetId: null },
        ],
        metadata: {},
        status: "approved",
      },
    });
    await db.render.create({
      data: {
        scriptId: script.id,
        audioPath: "/tmp/audio.wav",
        captionsPath: "/tmp/captions.json",
        status: "done",
        progress: 100,
      },
    });
  }
  for (let i = 0; i < opts.notApproved; i++) {
    const idea = await db.idea.create({
      data: { chapterId: chapter.id, title: `na${i}`, summary: "s", targetLengthSec: 12, status: "scripted" },
    });
    await db.script.create({
      data: {
        ideaId: idea.id,
        hook: "h",
        body: "b",
        cta: "c",
        visualBeats: [
          { start: 0, end: 6, mediaType: "photo", tone: "urgent", pickedAssetId: photoAsset.id },
        ],
        metadata: {},
        status: "draft",
      },
    });
  }
  return { chapterId: chapter.id, scripts };
}

describe("POST /api/renders/bulk", () => {
  beforeEach(async () => {
    await clear();
  });

  it("400 when chapterId missing", async () => {
    const req = new Request("http://test/api/renders/bulk", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("404 when chapter not found", async () => {
    const req = new Request("http://test/api/renders/bulk", {
      method: "POST",
      body: JSON.stringify({ chapterId: "missing" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("happy path: N approved-ready scripts → N jobs enqueued, response 202", async () => {
    const { chapterId } = await seedChapter({ approvedReady: 3, approvedMissingPicks: 0, notApproved: 0 });
    const req = new Request("http://test/api/renders/bulk", {
      method: "POST",
      body: JSON.stringify({ chapterId }),
    });
    const res = await POST(req);
    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobIds: string[]; scriptIds: string[]; skipped: string[] };
    expect(body.jobIds).toHaveLength(3);
    expect(body.scriptIds).toHaveLength(3);
    expect(body.skipped).toHaveLength(0);
    const jobs = await db.job.findMany({ where: { type: "render_script" } });
    expect(jobs).toHaveLength(3);
    for (const j of jobs) {
      expect(j.status).toBe("queued");
    }
  });

  it("skips approved scripts missing picks and unapproved scripts", async () => {
    const { chapterId } = await seedChapter({ approvedReady: 2, approvedMissingPicks: 1, notApproved: 1 });
    const req = new Request("http://test/api/renders/bulk", {
      method: "POST",
      body: JSON.stringify({ chapterId }),
    });
    const res = await POST(req);
    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobIds: string[]; scriptIds: string[]; skipped: string[] };
    expect(body.jobIds).toHaveLength(2);
    expect(body.skipped).toHaveLength(2);
  });

  it("409 when nothing is ready", async () => {
    const { chapterId } = await seedChapter({ approvedReady: 0, approvedMissingPicks: 1, notApproved: 0 });
    const req = new Request("http://test/api/renders/bulk", {
      method: "POST",
      body: JSON.stringify({ chapterId }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
  });

  it("resets each Render row to queued/0 before enqueuing", async () => {
    const { chapterId, scripts } = await seedChapter({ approvedReady: 1, approvedMissingPicks: 0, notApproved: 0 });
    // pre-pollute the Render row with a stale error
    await db.render.update({
      where: { scriptId: scripts[0]! },
      data: { status: "failed", error: "stale", videoPath: "/old/video.mp4" },
    });
    const req = new Request("http://test/api/renders/bulk", {
      method: "POST",
      body: JSON.stringify({ chapterId }),
    });
    await POST(req);
    const after = await db.render.findUniqueOrThrow({ where: { scriptId: scripts[0]! } });
    expect(after.status).toBe("queued");
    expect(after.error).toBeNull();
    expect(after.videoPath).toBeNull();
  });
});
