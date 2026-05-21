import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * `enqueueAndRun` is fire-and-forget — we mock it so the test doesn't try to
 * spawn Remotion. The route's job is just to create the Job row and 202.
 */
vi.mock("@/lib/jobs", async () => ({
  ensureHandlersRegistered: () => undefined,
  enqueueAndRun: vi.fn(),
}));

import { POST } from "./route";
import { db } from "../../../../../lib/db";

describe("POST /api/scripts/[id]/render", () => {
  let scriptId: string;
  let renderId: string;
  let photoAssetId: string;

  beforeEach(async () => {
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

    const book = await db.book.create({
      data: { title: "Finance", filePath: "/tmp/b.pdf", niche: "i", pageCount: 1, status: "ready" },
    });
    const chapter = await db.chapter.create({
      data: { bookId: book.id, title: "c1", orderIndex: 0, startPage: 0, endPage: 0, rawText: "x", status: "extracted" },
    });
    const idea = await db.idea.create({
      data: { chapterId: chapter.id, title: "t", summary: "s", targetLengthSec: 30, status: "scripted" },
    });
    const photoAsset = await db.asset.create({
      data: { type: "pexels_photo", localPath: "/tmp/x.jpg", width: 1080, height: 1920 },
    });
    photoAssetId = photoAsset.id;
    const script = await db.script.create({
      data: {
        ideaId: idea.id,
        hook: "h",
        body: "b",
        cta: "c",
        visualBeats: [
          { start: 0, end: 12, mediaType: "photo", tone: "urgent", pickedAssetId: photoAssetId },
        ],
        metadata: {},
        status: "approved",
      },
    });
    scriptId = script.id;
    const render = await db.render.create({
      data: {
        scriptId,
        audioPath: "/tmp/audio.wav",
        captionsPath: "/tmp/captions.json",
        durationSec: 12,
        fileSizeMB: 0.5,
        status: "done",
        progress: 100,
      },
    });
    renderId = render.id;
  });

  it("returns 404 when the script does not exist", async () => {
    const req = new Request("http://test", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("happy path: 202 with renderId+jobId, creates render_script Job, resets Render", async () => {
    // Pre-populate stale error to confirm reset.
    await db.render.update({ where: { id: renderId }, data: { error: "old", videoPath: "/old.mp4" } });

    const req = new Request("http://test", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: scriptId }) });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.renderId).toBe(renderId);
    expect(body.jobId).toBeDefined();

    const job = await db.job.findUniqueOrThrow({ where: { id: body.jobId } });
    expect(job.type).toBe("render_script");
    expect(job.targetType).toBe("Render");
    expect(job.targetId).toBe(renderId);
    expect((job.payload as { scriptId: string }).scriptId).toBe(scriptId);

    const render = await db.render.findUniqueOrThrow({ where: { id: renderId } });
    expect(render.status).toBe("queued");
    expect(render.progress).toBe(0);
    expect(render.error).toBeNull();
    expect(render.videoPath).toBeNull();
  });

  it("409 with missing=['audio'] when Render.audioPath is null", async () => {
    await db.render.update({ where: { id: renderId }, data: { audioPath: null } });
    const req = new Request("http://test", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: scriptId }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.missing).toContain("audio");
  });

  it("409 with missing=['captions'] when captions are null", async () => {
    await db.render.update({ where: { id: renderId }, data: { captionsPath: null } });
    const req = new Request("http://test", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: scriptId }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.missing).toContain("captions");
  });

  it("409 with explanation when any beat is missing pickedAssetId", async () => {
    await db.script.update({
      where: { id: scriptId },
      data: {
        visualBeats: [
          { start: 0, end: 6, mediaType: "photo", tone: "urgent", pickedAssetId: photoAssetId },
          { start: 6, end: 12, mediaType: "video", tone: "payoff", pickedAssetId: null },
        ],
      },
    });
    const req = new Request("http://test", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: scriptId }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.missing.some((s: string) => s.startsWith("picks"))).toBe(true);
  });
});
