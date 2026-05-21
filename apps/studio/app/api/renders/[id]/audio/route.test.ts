import { describe, it, expect, beforeEach, afterAll } from "vitest";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { db } from "../../../../../lib/db";
import { GET } from "./route";

const TMP_DIR = path.join(os.tmpdir(), "phase4-audio-route-test");

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

describe("GET /api/renders/[id]/audio", () => {
  let renderId: string;
  let audioPath: string;
  const TOTAL_BYTES = 1000;

  beforeEach(async () => {
    await db.render.deleteMany();
    await db.script.deleteMany();
    await db.suggestion.deleteMany();
    await db.idea.deleteMany();
    await db.chapter.deleteMany();
    await db.book.deleteMany();

    await fs.mkdir(TMP_DIR, { recursive: true });
    audioPath = path.join(TMP_DIR, "audio.wav");
    const buf = Buffer.alloc(TOTAL_BYTES);
    for (let i = 0; i < TOTAL_BYTES; i++) buf[i] = i & 0xff;
    await fs.writeFile(audioPath, buf);

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
      data: { scriptId: script.id, audioPath, status: "done", progress: 100 },
    });
    renderId = render.id;
  });

  afterAll(async () => {
    await fs.rm(TMP_DIR, { recursive: true, force: true });
  });

  it("returns full body with 200 + audio/wav + Content-Length + Accept-Ranges when no Range header", async () => {
    const req = new Request("http://test/api/renders/x/audio");
    const res = await GET(req, { params: Promise.resolve({ id: renderId }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(res.headers.get("content-length")).toBe(String(TOTAL_BYTES));
    expect(res.headers.get("accept-ranges")).toBe("bytes");

    const body = await consume(res.body);
    expect(body.length).toBe(TOTAL_BYTES);
  });

  it("returns 206 partial content with Content-Range for a valid Range header", async () => {
    const req = new Request("http://test/api/renders/x/audio", {
      headers: { Range: "bytes=100-199" },
    });
    const res = await GET(req, { params: Promise.resolve({ id: renderId }) });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 100-199/${TOTAL_BYTES}`);
    expect(res.headers.get("content-length")).toBe("100");
    const body = await consume(res.body);
    expect(body.length).toBe(100);
    expect(body[0]).toBe(100);
    expect(body[99]).toBe(199);
  });

  it("supports open-ended range bytes=N- by streaming to end of file", async () => {
    const req = new Request("http://test/api/renders/x/audio", {
      headers: { Range: "bytes=900-" },
    });
    const res = await GET(req, { params: Promise.resolve({ id: renderId }) });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 900-${TOTAL_BYTES - 1}/${TOTAL_BYTES}`);
    const body = await consume(res.body);
    expect(body.length).toBe(TOTAL_BYTES - 900);
  });

  it("returns 416 Range Not Satisfiable when start >= size", async () => {
    const req = new Request("http://test/api/renders/x/audio", {
      headers: { Range: `bytes=${TOTAL_BYTES + 100}-${TOTAL_BYTES + 200}` },
    });
    const res = await GET(req, { params: Promise.resolve({ id: renderId }) });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe(`bytes */${TOTAL_BYTES}`);
  });

  it("returns 416 for a malformed Range header", async () => {
    const req = new Request("http://test/api/renders/x/audio", {
      headers: { Range: "bytes=abc-def" },
    });
    const res = await GET(req, { params: Promise.resolve({ id: renderId }) });
    expect(res.status).toBe(416);
  });

  it("returns 404 for an unknown render id", async () => {
    const req = new Request("http://test/api/renders/x/audio");
    const res = await GET(req, { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("returns 410 Gone when render.audioPath points to a missing file", async () => {
    await db.render.update({ where: { id: renderId }, data: { audioPath: "/no/such/file.wav" } });
    const req = new Request("http://test/api/renders/x/audio");
    const res = await GET(req, { params: Promise.resolve({ id: renderId }) });
    expect(res.status).toBe(410);
  });
});
