import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";

vi.mock("@/lib/jobs", () => ({
  ensureHandlersRegistered: () => undefined,
  enqueueAndRun: vi.fn(),
}));

import { POST } from "./route";
import { db } from "../../../../../lib/db";

const TMP_OUTPUT_DIR = path.join(os.tmpdir(), "phase6-rerender-test");

describe("POST /api/renders/[id]/rerender", () => {
  let renderId: string;
  let scriptId: string;

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
    scriptId = script.id;
    const render = await db.render.create({
      data: { scriptId, status: "done", progress: 100, videoPath: "/tmp/old.mp4" },
    });
    renderId = render.id;
  });

  afterAll(async () => {
    await fs.rm(TMP_OUTPUT_DIR, { recursive: true, force: true });
  });

  it("returns 404 when the render row does not exist", async () => {
    const req = new Request("http://test", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("returns 404 when no saved render-input.json exists on disk", async () => {
    // Ensure no file at the expected location.
    const inputPath = path.resolve("output", scriptId, "render-input.json");
    await fs.rm(inputPath, { force: true });
    const req = new Request("http://test", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: renderId }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/no saved render-input/);
  });

  it("happy path: 202 + creates render_script job with reuseInput=true", async () => {
    // Stage a render-input.json under the real `output/<scriptId>/` so the
    // route's existsSync check passes.
    const stageDir = path.resolve("output", scriptId);
    await fs.mkdir(stageDir, { recursive: true });
    const inputPath = path.join(stageDir, "render-input.json");
    await fs.writeFile(inputPath, JSON.stringify({ scriptId, fps: 30 }));

    try {
      const req = new Request("http://test", { method: "POST" });
      const res = await POST(req, { params: Promise.resolve({ id: renderId }) });
      expect(res.status).toBe(202);
      const body = await res.json();
      expect(body.renderId).toBe(renderId);
      expect(body.jobId).toBeDefined();

      const job = await db.job.findUniqueOrThrow({ where: { id: body.jobId } });
      expect(job.type).toBe("render_script");
      expect((job.payload as { scriptId: string; reuseInput: boolean }).reuseInput).toBe(true);
      expect((job.payload as { scriptId: string }).scriptId).toBe(scriptId);
    } finally {
      await fs.rm(stageDir, { recursive: true, force: true });
    }
  });
});
