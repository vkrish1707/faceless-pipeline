import { describe, it, expect, beforeEach, afterAll } from "vitest";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { db } from "../../../../../lib/db";
import { GET } from "./route";

/**
 * Streaming MP4 route. Same Range-support pattern as the audio route, with
 * Content-Type set to video/mp4. We assert the headers and the actual byte
 * payload for both full and partial responses.
 */

const TMP_DIR = path.join(os.tmpdir(), "phase6-video-route-test");

async function consume(stream: ReadableStream<Uint8Array> | null): Promise<Buffer> {
  if (!stream) return Buffer.alloc(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

describe("GET /api/renders/[id]/video", () => {
  let renderId: string;
  let videoPath: string;
  const TOTAL_BYTES = 1000;

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

    await fs.mkdir(TMP_DIR, { recursive: true });
    videoPath = path.join(TMP_DIR, "video.mp4");
    const buf = Buffer.alloc(TOTAL_BYTES);
    for (let i = 0; i < TOTAL_BYTES; i++) buf[i] = i & 0xff;
    await fs.writeFile(videoPath, buf);

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
      data: { scriptId: script.id, videoPath, status: "done", progress: 100 },
    });
    renderId = render.id;
  });

  afterAll(async () => {
    await fs.rm(TMP_DIR, { recursive: true, force: true });
  });

  it("returns 200 video/mp4 with Content-Length and Accept-Ranges for the full body", async () => {
    const req = new Request("http://test/api/renders/x/video");
    const res = await GET(req, { params: Promise.resolve({ id: renderId }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("content-length")).toBe(String(TOTAL_BYTES));
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    const body = await consume(res.body);
    expect(body.length).toBe(TOTAL_BYTES);
  });

  it("returns 206 partial content with Content-Range for a valid Range header", async () => {
    const req = new Request("http://test/api/renders/x/video", {
      headers: { Range: "bytes=100-199" },
    });
    const res = await GET(req, { params: Promise.resolve({ id: renderId }) });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 100-199/${TOTAL_BYTES}`);
    expect(res.headers.get("content-length")).toBe("100");
    const body = await consume(res.body);
    expect(body[0]).toBe(100);
    expect(body[99]).toBe(199);
  });

  it("returns 404 when the render row has no videoPath", async () => {
    await db.render.update({ where: { id: renderId }, data: { videoPath: null } });
    const req = new Request("http://test");
    const res = await GET(req, { params: Promise.resolve({ id: renderId }) });
    expect(res.status).toBe(404);
  });

  it("returns 410 Gone when the file is missing on disk", async () => {
    await fs.rm(videoPath);
    const req = new Request("http://test");
    const res = await GET(req, { params: Promise.resolve({ id: renderId }) });
    expect(res.status).toBe(410);
  });
});
