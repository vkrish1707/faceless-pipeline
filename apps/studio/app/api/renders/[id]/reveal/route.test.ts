import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "./route";
import { db } from "../../../../../lib/db";

/**
 * Reveal is fire-and-forget — we just verify it returns 204 across the
 * relevant branches without raising. We don't try to assert the spawn since
 * it's gated behind process.platform.
 */

describe("POST /api/renders/[id]/reveal", () => {
  let renderId: string;

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
      data: { title: "t", filePath: "/tmp/x.pdf", niche: "n", pageCount: 1, status: "ready" },
    });
    const chapter = await db.chapter.create({
      data: { bookId: book.id, title: "c", orderIndex: 0, startPage: 0, endPage: 0, rawText: "x", status: "extracted" },
    });
    const idea = await db.idea.create({
      data: { chapterId: chapter.id, title: "i", summary: "s", targetLengthSec: 30, status: "approved" },
    });
    const script = await db.script.create({
      data: { ideaId: idea.id, hook: "h", body: "b", cta: "c", visualBeats: [], metadata: {}, status: "draft" },
    });
    const render = await db.render.create({
      data: { scriptId: script.id, status: "done", progress: 100 },
    });
    renderId = render.id;
  });

  it("returns 204 when the render has no videoPath", async () => {
    const req = new Request("http://test", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: renderId }) });
    expect(res.status).toBe(204);
  });

  it("returns 204 when the render does not exist", async () => {
    const req = new Request("http://test", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(204);
  });

  it("returns 204 even when videoPath points to a nonexistent file", async () => {
    await db.render.update({ where: { id: renderId }, data: { videoPath: "/tmp/does/not/exist.mp4" } });
    const req = new Request("http://test", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: renderId }) });
    expect(res.status).toBe(204);
  });
});
