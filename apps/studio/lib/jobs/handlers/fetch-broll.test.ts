import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "../../db";
import { runJob, registerHandler, _resetHandlers } from "../runner";
import { createFetchBrollHandler } from "./fetch-broll";

describe("handleFetchBroll", () => {
  let bookId: string;
  let chapterId: string;
  let ideaId: string;
  let scriptId: string;
  let cacheDir: string;

  beforeEach(async () => {
    _resetHandlers();
    cacheDir = mkdtempSync(join(tmpdir(), "broll-cache-"));

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
      data: { title: "Finance", filePath: "/tmp/b.pdf", niche: "investing", pageCount: 1, status: "ready" },
    });
    bookId = book.id;
    const chapter = await db.chapter.create({
      data: { bookId, title: "C1", orderIndex: 0, startPage: 0, endPage: 0, rawText: "x", status: "extracted" },
    });
    chapterId = chapter.id;
    const idea = await db.idea.create({
      data: { chapterId, title: "T", summary: "S", targetLengthSec: 30, status: "draft" },
    });
    ideaId = idea.id;
    const visualBeats = [
      { start: 0, end: 4, keywords: ["compound", "interest"], mediaType: "photo", tone: "explainer" },
      { start: 4, end: 10, keywords: ["forest"], mediaType: "video", tone: "payoff" },
      { start: 10, end: 12, keywords: [], mediaType: "photo", tone: "urgent" }, // empty -> skipped
    ];
    const script = await db.script.create({
      data: {
        ideaId,
        hook: "h",
        body: "b".repeat(60),
        cta: "cta",
        visualBeats,
        metadata: {},
        status: "draft",
      },
    });
    scriptId = script.id;

    process.env.PEXELS_API_KEY = "test-key-1234567890";
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  function buildMocks() {
    const photos = Array.from({ length: 6 }, (_, i) => ({
      id: 100 + i,
      thumb: `https://img.example.com/p${i}-thumb.jpg`,
      full: `https://img.example.com/p${i}-full.jpg`,
      alt: "",
      width: 1080,
      height: 1920,
    }));
    const videos = Array.from({ length: 6 }, (_, i) => ({
      id: 200 + i,
      thumb: `https://img.example.com/v${i}-thumb.jpg`,
      full: `https://img.example.com/v${i}-full.mp4`,
      width: 1080,
      height: 1920,
      durationSec: 10,
    }));

    const searchPhotos = vi.fn(async () => photos);
    const searchVideos = vi.fn(async () => videos);
    const downloadAsset = vi.fn(async (opts: { url: string }) => ({
      localPath: join(cacheDir, `${Buffer.from(opts.url).toString("base64url")}.jpg`),
      bytes: 4096,
      contentType: "image/jpeg",
    }));

    return { searchPhotos, searchVideos, downloadAsset, photos, videos };
  }

  it("fetches Pexels per beat, downloads thumbs, and persists Asset rows", async () => {
    const mocks = buildMocks();
    const handler = createFetchBrollHandler({
      searchPhotos: mocks.searchPhotos as never,
      searchVideos: mocks.searchVideos as never,
      downloadAsset: mocks.downloadAsset as never,
      cacheDir,
    });
    registerHandler("fetch_broll", handler);

    const job = await db.job.create({
      data: {
        type: "fetch_broll",
        status: "queued",
        targetType: "Script",
        targetId: scriptId,
        payload: { scriptId },
      },
    });
    await runJob(job.id);

    const after = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe("completed");
    expect(after.progress).toBe(100);

    // 2 beats with keywords * 5 candidates each = 10 Asset rows. Third beat skipped.
    const assets = await db.asset.findMany({ where: { scriptId }, orderBy: [{ beatIndex: "asc" }, { id: "asc" }] });
    expect(assets).toHaveLength(10);
    expect(new Set(assets.map((a) => a.beatIndex))).toEqual(new Set([0, 1]));
    expect(assets.filter((a) => a.type === "pexels_photo")).toHaveLength(5);
    expect(assets.filter((a) => a.type === "pexels_video")).toHaveLength(5);
    expect(assets.every((a) => a.localPath.startsWith(cacheDir))).toBe(true);
    expect(assets.every((a) => a.thumbPath === a.localPath)).toBe(true);

    const photoAsset = assets.find((a) => a.type === "pexels_photo");
    expect(photoAsset!.keyword).toBe("compound interest");

    const videoAsset = assets.find((a) => a.type === "pexels_video");
    expect(videoAsset!.durationSec).toBe(10);

    // ApiUsage row tracks pexels search.
    const usage = await db.apiUsage.findMany();
    expect(usage).toHaveLength(1);
    expect(usage[0]!.service).toBe("pexels");
    expect(usage[0]!.endpoint).toBe("search");

    // PexelsCache populated for 2 queries (photo + video).
    const cacheRows = await db.pexelsCache.findMany();
    expect(cacheRows).toHaveLength(2);

    // Result counts.
    const result = after.result as {
      beatsProcessed: number;
      beatsSkipped: number;
      candidatesPersisted: number;
      cacheHits: number;
      cacheMisses: number;
    };
    expect(result.beatsProcessed).toBe(2);
    expect(result.beatsSkipped).toBe(1);
    expect(result.candidatesPersisted).toBe(10);
    expect(result.cacheMisses).toBe(2);
    expect(result.cacheHits).toBe(0);
  });

  it("re-uses cached responses on a second run", async () => {
    const mocks = buildMocks();
    const handler = createFetchBrollHandler({
      searchPhotos: mocks.searchPhotos as never,
      searchVideos: mocks.searchVideos as never,
      downloadAsset: mocks.downloadAsset as never,
      cacheDir,
    });
    registerHandler("fetch_broll", handler);

    const job1 = await db.job.create({
      data: { type: "fetch_broll", status: "queued", targetType: "Script", targetId: scriptId, payload: { scriptId } },
    });
    await runJob(job1.id);
    const photoCalls1 = mocks.searchPhotos.mock.calls.length;
    const videoCalls1 = mocks.searchVideos.mock.calls.length;

    const job2 = await db.job.create({
      data: { type: "fetch_broll", status: "queued", targetType: "Script", targetId: scriptId, payload: { scriptId } },
    });
    await runJob(job2.id);

    expect(mocks.searchPhotos.mock.calls.length).toBe(photoCalls1);
    expect(mocks.searchVideos.mock.calls.length).toBe(videoCalls1);

    const after = await db.job.findUniqueOrThrow({ where: { id: job2.id } });
    const result = after.result as { cacheHits: number; cacheMisses: number };
    expect(result.cacheHits).toBe(2);
    expect(result.cacheMisses).toBe(0);
  });

  it("invalidates cache when refresh=true", async () => {
    const mocks = buildMocks();
    const handler = createFetchBrollHandler({
      searchPhotos: mocks.searchPhotos as never,
      searchVideos: mocks.searchVideos as never,
      downloadAsset: mocks.downloadAsset as never,
      cacheDir,
    });
    registerHandler("fetch_broll", handler);

    const job1 = await db.job.create({
      data: { type: "fetch_broll", status: "queued", targetType: "Script", targetId: scriptId, payload: { scriptId } },
    });
    await runJob(job1.id);

    const job2 = await db.job.create({
      data: {
        type: "fetch_broll",
        status: "queued",
        targetType: "Script",
        targetId: scriptId,
        payload: { scriptId, refresh: true },
      },
    });
    await runJob(job2.id);

    const after = await db.job.findUniqueOrThrow({ where: { id: job2.id } });
    const result = after.result as { cacheHits: number; cacheMisses: number };
    expect(result.cacheMisses).toBe(2);
    expect(result.cacheHits).toBe(0);
  });

  it("preserves manual assets when re-fetching", async () => {
    await db.asset.create({
      data: {
        scriptId,
        beatIndex: 0,
        type: "manual",
        localPath: "/tmp/manual.jpg",
        thumbPath: "/tmp/manual.jpg",
      },
    });

    const mocks = buildMocks();
    const handler = createFetchBrollHandler({
      searchPhotos: mocks.searchPhotos as never,
      searchVideos: mocks.searchVideos as never,
      downloadAsset: mocks.downloadAsset as never,
      cacheDir,
    });
    registerHandler("fetch_broll", handler);

    const job = await db.job.create({
      data: { type: "fetch_broll", status: "queued", targetType: "Script", targetId: scriptId, payload: { scriptId } },
    });
    await runJob(job.id);

    const manualAssets = await db.asset.findMany({ where: { scriptId, type: "manual" } });
    expect(manualAssets).toHaveLength(1);
  });
});
