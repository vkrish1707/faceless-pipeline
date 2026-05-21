import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/jobs", async () => ({
  ensureHandlersRegistered: () => undefined,
  enqueueAndRun: vi.fn(),
}));

import { POST } from "./route";
import { db } from "../../../../../lib/db";

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

async function seedFailedRender(opts: { audioPath?: string | null; captionsPath?: string | null; pickedAssetId?: string | null }) {
  const book = await db.book.create({
    data: { title: "B", filePath: "/tmp/b.pdf", niche: "i", pageCount: 1, status: "ready" },
  });
  const chapter = await db.chapter.create({
    data: { bookId: book.id, title: "C", orderIndex: 0, startPage: 0, endPage: 0, rawText: "x", status: "extracted" },
  });
  const idea = await db.idea.create({
    data: { chapterId: chapter.id, title: "t", summary: "s", targetLengthSec: 12, status: "scripted" },
  });
  const asset = await db.asset.create({
    data: { type: "pexels_photo", localPath: "/tmp/x.jpg", width: 1080, height: 1920 },
  });
  const script = await db.script.create({
    data: {
      ideaId: idea.id,
      hook: "h",
      body: "b",
      cta: "c",
      visualBeats: [
        { start: 0, end: 6, mediaType: "photo", tone: "urgent", pickedAssetId: opts.pickedAssetId === undefined ? asset.id : opts.pickedAssetId },
      ],
      metadata: {},
      status: "approved",
    },
  });
  const render = await db.render.create({
    data: {
      scriptId: script.id,
      audioPath: opts.audioPath === undefined ? "/tmp/a.wav" : opts.audioPath,
      captionsPath: opts.captionsPath === undefined ? "/tmp/c.json" : opts.captionsPath,
      videoPath: "/old/video.mp4",
      metadataPath: "/old/meta.txt",
      status: "failed",
      progress: 30,
      error: "previous failure",
    },
  });
  return { renderId: render.id, scriptId: script.id };
}

describe("POST /api/renders/[id]/retry", () => {
  beforeEach(async () => {
    await clear();
  });

  it("404 when render missing", async () => {
    const req = new Request("http://test", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("409 when render is not in failed status", async () => {
    const { renderId } = await seedFailedRender({});
    await db.render.update({ where: { id: renderId }, data: { status: "done" } });
    const req = new Request("http://test", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: renderId }) });
    expect(res.status).toBe(409);
  });

  it("409 when audio missing on a failed render", async () => {
    const { renderId } = await seedFailedRender({ audioPath: null });
    const req = new Request("http://test", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: renderId }) });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { missing: string[] };
    expect(body.missing).toContain("audio");
  });

  it("409 when captions missing", async () => {
    const { renderId } = await seedFailedRender({ captionsPath: null });
    const req = new Request("http://test", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: renderId }) });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { missing: string[] };
    expect(body.missing).toContain("captions");
  });

  it("409 when any beat is missing pickedAssetId", async () => {
    const { renderId } = await seedFailedRender({ pickedAssetId: null });
    const req = new Request("http://test", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: renderId }) });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { missing: string[] };
    expect(body.missing.some((m) => m.startsWith("picks"))).toBe(true);
  });

  it("happy path: resets fields to null and queues a fresh render_script Job", async () => {
    const { renderId } = await seedFailedRender({});
    const req = new Request("http://test", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: renderId }) });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobId: string; renderId: string };
    expect(body.renderId).toBe(renderId);
    const after = await db.render.findUniqueOrThrow({ where: { id: renderId } });
    expect(after.status).toBe("queued");
    expect(after.error).toBeNull();
    expect(after.videoPath).toBeNull();
    expect(after.metadataPath).toBeNull();
    const job = await db.job.findUniqueOrThrow({ where: { id: body.jobId } });
    expect(job.type).toBe("render_script");
    expect(job.status).toBe("queued");
  });
});
