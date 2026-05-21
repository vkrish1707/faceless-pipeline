import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "node:path";
import { db } from "../../db";
import { runJob, registerHandler, _resetHandlers } from "../runner";
import {
  createRenderScriptHandler,
  kebabSlug,
  buildMetadataTxt,
  RemotionRenderError,
  EmptyMp4Error,
  DiskLowError,
} from "./render-script";

/**
 * Orchestrator tests for render_script. The Remotion CLI, ffprobe, and ffmpeg
 * are all injected as deps so the handler runs deterministically in CI.
 *
 * Fixture: a single 3-beat script with Render row already in the "done" audio
 * state (the gate the API route enforces).
 */

type FakeFs = ReturnType<typeof makeFakeFs>;

function makeFakeFs(opts: { videoBytes?: number; freeBytes?: number | null; existing?: Set<string> } = {}) {
  const writes = new Map<string, string>();
  const copies: Array<[string, string]> = [];
  const existing = new Set<string>(opts.existing ?? []);
  const videoBytes = opts.videoBytes ?? 500 * 1024;
  return {
    writes,
    copies,
    existing,
    videoBytes,
    fsImpl: {
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async (p: string, data: string) => {
        writes.set(p, data);
        existing.add(p);
      }),
      readFile: vi.fn(async (p: string, _encoding?: BufferEncoding) => {
        const w = writes.get(p);
        if (w !== undefined) return w;
        // For lazy-download path lookups: just return empty buffer.
        return Buffer.from("");
      }),
      copyFile: vi.fn(async (from: string, to: string) => {
        copies.push([from, to]);
        existing.add(to);
      }),
      stat: vi.fn(async (_p: string) => ({ size: videoBytes })),
      existsSync: (p: string) => existing.has(p),
      freeBytes: (_p: string) => (opts.freeBytes === undefined ? 10 * 1024 * 1024 * 1024 : opts.freeBytes),
    },
  };
}

async function seedFixture() {
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

  const book = await db.book.create({
    data: { title: "Finance Basics", filePath: "/tmp/b.pdf", niche: "investing", pageCount: 1, status: "ready" },
  });
  const chapter = await db.chapter.create({
    data: { bookId: book.id, title: "Chapter 1", orderIndex: 0, startPage: 0, endPage: 0, rawText: "x", status: "extracted" },
  });
  const idea = await db.idea.create({
    data: {
      chapterId: chapter.id,
      title: "Compound interest is the eighth wonder",
      summary: "starting early beats catching up later",
      targetLengthSec: 12,
      status: "scripted",
    },
  });

  const aPhoto = await db.asset.create({
    data: { type: "pexels_photo", sourceUrl: "https://x.example.com/p.jpg", localPath: "/tmp/photo.jpg", width: 1080, height: 1920 },
  });
  const aVideo = await db.asset.create({
    data: { type: "pexels_video", sourceUrl: "https://x.example.com/v.mp4", localPath: "/tmp/clip.mp4", width: 1080, height: 1920 },
  });

  const script = await db.script.create({
    data: {
      ideaId: idea.id,
      hook: "Most people miss the real lever of wealth",
      body: "It is time, not income.",
      cta: "Start now.",
      visualBeats: [
        { start: 0, end: 6, mediaType: "photo", tone: "urgent", pickedAssetId: aPhoto.id, keywords: ["clock"] },
        { start: 6, end: 12, mediaType: "video", tone: "payoff", pickedAssetId: aVideo.id, keywords: ["forest"] },
      ],
      metadata: {
        youtubeTitle: "How 8% beats your paycheck",
        caption: "compound math",
        hashtags: ["#money", "#finance"],
        thumbnailConcept: "stack of bills with arrow",
      },
      score: 82,
      scoreBreakdown: {
        hook_strength: 22,
        specificity: 16,
        trend_alignment: 20,
        format_fit: 12,
        shelf_life: 12,
        reasoning: "strong opening + concrete number",
      },
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

  return { scriptId: script.id, photoId: aPhoto.id, videoId: aVideo.id };
}

function makeMockBuildRenderInput(scriptId: string) {
  return vi.fn(async () => ({
    scriptId,
    durationFrames: 360,
    fps: 30 as const,
    width: 1080 as const,
    height: 1920 as const,
    audioPath: "/tmp/audio.wav",
    captions: { words: [{ word: "x", start: 0, end: 12 }] },
    visualBeats: [
      { start: 0, end: 6, tone: "urgent" as const, assetPath: "/tmp/photo.jpg", assetType: "photo" as const },
      { start: 6, end: 12, tone: "payoff" as const, assetPath: "/tmp/clip.mp4", assetType: "video" as const },
    ],
    theme: "finance-dark" as const,
    metadata: {
      youtubeTitle: "How 8% beats your paycheck",
      caption: "compound math",
      hashtags: ["#money", "#finance"],
      thumbnailConcept: "stack of bills with arrow",
    },
    hookText: "Most people miss the real lever of wealth",
    ctaText: "Start now.",
  }));
}

describe("handleRenderScript", () => {
  let scriptId: string;

  beforeEach(async () => {
    _resetHandlers();
    const seeded = await seedFixture();
    scriptId = seeded.scriptId;
  });

  it("happy path: writes render-input.json, runs remotion, probes, bundles, marks Render done", async () => {
    const { fsImpl, writes, copies, existing } = makeFakeFs();
    // Mark the two beat assets as existing on disk so we skip lazy download.
    existing.add("/tmp/photo.jpg");
    existing.add("/tmp/clip.mp4");
    existing.add("/tmp/audio.wav");
    existing.add("/tmp/captions.json");

    const spawnRemotion = vi.fn(async ({ outPath }: { outPath: string }) => {
      // pretend remotion wrote the file
      existing.add(outPath);
    });
    const probeMedia = vi.fn(async () => ({
      width: 1080,
      height: 1920,
      durationSec: 12.0,
      codec: "h264",
      hasAudio: true,
    }));
    const extractThumbnail = vi.fn(async () => undefined);
    const downloadAsset = vi.fn(async () => ({ localPath: "/tmp/dl.jpg", bytes: 100, contentType: "image/jpeg" }));

    const handler = createRenderScriptHandler({
      buildRenderInput: makeMockBuildRenderInput(scriptId) as never,
      spawnRemotion: spawnRemotion as never,
      probeMedia: probeMedia as never,
      extractThumbnail: extractThumbnail as never,
      downloadAsset: downloadAsset as never,
      fsImpl,
      outputRoot: "/tmp/render-test/output",
    });
    registerHandler("render_script", handler);

    const renderRow = await db.render.findUniqueOrThrow({ where: { scriptId } });
    const job = await db.job.create({
      data: { type: "render_script", status: "queued", targetType: "Render", targetId: renderRow.id, payload: { scriptId } },
    });
    await runJob(job.id);

    const finalJob = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(finalJob.status, finalJob.error ?? "").toBe("completed");

    // render-input.json was written, then read by spawn through `--props=...`.
    const renderInputWrite = Array.from(writes.entries()).find(([p]) => p.endsWith("render-input.json"));
    expect(renderInputWrite).toBeDefined();
    expect(JSON.parse(renderInputWrite![1]).scriptId).toBe(scriptId);

    expect(spawnRemotion).toHaveBeenCalledTimes(1);
    expect(probeMedia).toHaveBeenCalledTimes(1);
    expect(extractThumbnail).toHaveBeenCalledTimes(1);
    // No download needed since both beat assets existed on disk.
    expect(downloadAsset).not.toHaveBeenCalled();

    const after = await db.render.findUniqueOrThrow({ where: { scriptId } });
    expect(after.status).toBe("done");
    expect(after.progress).toBe(100);
    expect(after.videoPath).toMatch(/video\.mp4$/);
    expect(after.metadataPath).toMatch(/metadata\.txt$/);
    expect(after.durationSec).toBe(12);
    expect(after.fileSizeMB).toBeGreaterThan(0);
    expect(after.error).toBeNull();

    // metadata.txt content is correctly shaped.
    const metaWrite = Array.from(writes.entries()).find(([p]) => p.endsWith("metadata.txt"));
    expect(metaWrite![1]).toMatch(/=== YOUTUBE SHORTS ===/);
    expect(metaWrite![1]).toMatch(/Title: How 8% beats your paycheck/);
    expect(metaWrite![1]).toMatch(/=== SCORE: 82\/100 ===/);
    expect(metaWrite![1]).toMatch(/hook_strength 22\/25/);
    expect(metaWrite![1]).toMatch(/Reasoning: strong opening/);

    // The freshly-rendered staging mp4 was copied into the slug-named bundle dir.
    const finalCopy = copies.find(([_, to]) => to.endsWith("video.mp4"));
    expect(finalCopy).toBeDefined();
    expect(finalCopy![1]).toMatch(/finance-basics\/chapter-1\//);
    // debug artifacts copied
    const debugCopies = copies.filter(([_, to]) => to.includes("/debug/"));
    expect(debugCopies.map(([_, to]) => path.basename(to))).toEqual(
      expect.arrayContaining(["audio.wav", "captions.json", "render-input.json"])
    );

    // ApiUsage row recorded.
    const usage = await db.apiUsage.findMany();
    expect(usage.find((u) => u.service === "remotion" && u.endpoint === "render")).toBeDefined();
  });

  it("non-zero remotion exit → Render.error captured, status=failed", async () => {
    const { fsImpl, existing } = makeFakeFs();
    existing.add("/tmp/photo.jpg");
    existing.add("/tmp/clip.mp4");
    const spawnRemotion = vi.fn(async () => {
      throw new RemotionRenderError(1, "fatal: shader compile failed");
    });

    const handler = createRenderScriptHandler({
      buildRenderInput: makeMockBuildRenderInput(scriptId) as never,
      spawnRemotion: spawnRemotion as never,
      probeMedia: vi.fn() as never,
      extractThumbnail: vi.fn() as never,
      downloadAsset: vi.fn() as never,
      fsImpl,
      outputRoot: "/tmp/render-test/output",
    });
    registerHandler("render_script", handler);

    const renderRow = await db.render.findUniqueOrThrow({ where: { scriptId } });
    const job = await db.job.create({
      data: { type: "render_script", status: "queued", targetType: "Render", targetId: renderRow.id, payload: { scriptId } },
    });
    await runJob(job.id);

    const finalJob = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(finalJob.status).toBe("failed");
    const after = await db.render.findUniqueOrThrow({ where: { scriptId } });
    expect(after.status).toBe("failed");
    expect(after.error).toMatch(/shader compile failed/);
  });

  it("MP4 < 100KB → marks Render failed with EmptyMp4Error message", async () => {
    const { fsImpl, existing } = makeFakeFs({ videoBytes: 10 * 1024 });
    existing.add("/tmp/photo.jpg");
    existing.add("/tmp/clip.mp4");
    const spawnRemotion = vi.fn(async ({ outPath }: { outPath: string }) => {
      existing.add(outPath);
    });

    const handler = createRenderScriptHandler({
      buildRenderInput: makeMockBuildRenderInput(scriptId) as never,
      spawnRemotion: spawnRemotion as never,
      probeMedia: vi.fn() as never,
      extractThumbnail: vi.fn() as never,
      downloadAsset: vi.fn() as never,
      fsImpl,
      outputRoot: "/tmp/render-test/output",
    });
    registerHandler("render_script", handler);

    const renderRow = await db.render.findUniqueOrThrow({ where: { scriptId } });
    const job = await db.job.create({
      data: { type: "render_script", status: "queued", targetType: "Render", targetId: renderRow.id, payload: { scriptId } },
    });
    await runJob(job.id);

    const finalJob = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(finalJob.status).toBe("failed");
    const after = await db.render.findUniqueOrThrow({ where: { scriptId } });
    expect(after.status).toBe("failed");
    expect(after.error).toMatch(/empty mp4/);
  });

  it("ffprobe failure falls back to input.durationFrames math and warns", async () => {
    const { fsImpl, existing } = makeFakeFs();
    existing.add("/tmp/photo.jpg");
    existing.add("/tmp/clip.mp4");
    existing.add("/tmp/audio.wav");
    existing.add("/tmp/captions.json");
    const spawnRemotion = vi.fn(async ({ outPath }: { outPath: string }) => {
      existing.add(outPath);
    });
    const probeMedia = vi.fn(async () => {
      throw new Error("ffprobe not installed");
    });

    const handler = createRenderScriptHandler({
      buildRenderInput: makeMockBuildRenderInput(scriptId) as never,
      spawnRemotion: spawnRemotion as never,
      probeMedia: probeMedia as never,
      extractThumbnail: vi.fn(async () => undefined) as never,
      downloadAsset: vi.fn() as never,
      fsImpl,
      outputRoot: "/tmp/render-test/output",
    });
    registerHandler("render_script", handler);

    const renderRow = await db.render.findUniqueOrThrow({ where: { scriptId } });
    const job = await db.job.create({
      data: { type: "render_script", status: "queued", targetType: "Render", targetId: renderRow.id, payload: { scriptId } },
    });
    await runJob(job.id);

    const after = await db.render.findUniqueOrThrow({ where: { scriptId } });
    expect(after.status).toBe("done");
    expect(after.durationSec).toBeCloseTo(12, 1); // 360/30
    expect(after.warning).toMatch(/ffprobe failed/);
  });

  it("rejects with MissingPrerequisiteError when a beat pickedAssetId is null (via buildRenderInput)", async () => {
    // Wipe pickedAssetId on the first beat and use the real buildRenderInput.
    await db.script.update({
      where: { id: scriptId },
      data: {
        visualBeats: [
          { start: 0, end: 6, mediaType: "photo", tone: "urgent", pickedAssetId: null, keywords: ["clock"] },
          { start: 6, end: 12, mediaType: "video", tone: "payoff", pickedAssetId: null, keywords: ["forest"] },
        ],
      },
    });

    const { fsImpl } = makeFakeFs();
    const handler = createRenderScriptHandler({
      spawnRemotion: vi.fn() as never,
      probeMedia: vi.fn() as never,
      extractThumbnail: vi.fn() as never,
      downloadAsset: vi.fn() as never,
      fsImpl,
      outputRoot: "/tmp/render-test/output",
    });
    registerHandler("render_script", handler);

    const renderRow = await db.render.findUniqueOrThrow({ where: { scriptId } });
    const job = await db.job.create({
      data: { type: "render_script", status: "queued", targetType: "Render", targetId: renderRow.id, payload: { scriptId } },
    });
    await runJob(job.id);

    const finalJob = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(finalJob.status).toBe("failed");
    expect(finalJob.error).toMatch(/pickedAsset:0/);
  });

  it("refuses with disk_low when free space < 2 GiB", async () => {
    const { fsImpl } = makeFakeFs({ freeBytes: 100 * 1024 * 1024 });
    const handler = createRenderScriptHandler({
      buildRenderInput: makeMockBuildRenderInput(scriptId) as never,
      spawnRemotion: vi.fn() as never,
      probeMedia: vi.fn() as never,
      extractThumbnail: vi.fn() as never,
      downloadAsset: vi.fn() as never,
      fsImpl,
      outputRoot: "/tmp/render-test/output",
    });
    registerHandler("render_script", handler);

    const renderRow = await db.render.findUniqueOrThrow({ where: { scriptId } });
    const job = await db.job.create({
      data: { type: "render_script", status: "queued", targetType: "Render", targetId: renderRow.id, payload: { scriptId } },
    });
    await runJob(job.id);

    const finalJob = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(finalJob.status).toBe("failed");
    expect(finalJob.error).toMatch(/disk_low/);
  });

  it("reuseInput=true skips buildRenderInput and reads render-input.json from disk", async () => {
    const { fsImpl, writes, existing } = makeFakeFs();
    existing.add("/tmp/photo.jpg");
    existing.add("/tmp/clip.mp4");
    existing.add("/tmp/audio.wav");
    existing.add("/tmp/captions.json");

    // Pre-stage a render-input.json under the staging dir.
    const stagingPath = `/tmp/render-test/output/${scriptId}/render-input.json`;
    const fakeInput = {
      scriptId,
      durationFrames: 360,
      fps: 30,
      width: 1080,
      height: 1920,
      audioPath: "/tmp/audio.wav",
      captions: { words: [{ word: "x", start: 0, end: 12 }] },
      visualBeats: [
        { start: 0, end: 12, tone: "urgent", assetPath: "/tmp/photo.jpg", assetType: "photo" },
      ],
      theme: "finance-dark",
      metadata: { youtubeTitle: "T", caption: "", hashtags: [], thumbnailConcept: "" },
    };
    writes.set(stagingPath, JSON.stringify(fakeInput));
    existing.add(stagingPath);

    const spawnRemotion = vi.fn(async ({ outPath }: { outPath: string }) => {
      existing.add(outPath);
    });
    const buildRenderInput = vi.fn();

    const handler = createRenderScriptHandler({
      buildRenderInput: buildRenderInput as never,
      spawnRemotion: spawnRemotion as never,
      probeMedia: vi.fn(async () => ({ width: 1080, height: 1920, durationSec: 12, codec: "h264", hasAudio: true })) as never,
      extractThumbnail: vi.fn() as never,
      downloadAsset: vi.fn() as never,
      fsImpl,
      outputRoot: "/tmp/render-test/output",
    });
    registerHandler("render_script", handler);

    const renderRow = await db.render.findUniqueOrThrow({ where: { scriptId } });
    const job = await db.job.create({
      data: { type: "render_script", status: "queued", targetType: "Render", targetId: renderRow.id, payload: { scriptId, reuseInput: true } },
    });
    await runJob(job.id);

    const finalJob = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(finalJob.status, finalJob.error ?? "").toBe("completed");
    expect(buildRenderInput).not.toHaveBeenCalled();
  });
});

describe("kebabSlug", () => {
  it("lowercases and replaces non-alphanumerics with single dashes", () => {
    expect(kebabSlug("Finance Basics — 2024!")).toBe("finance-basics-2024");
  });

  it("trims leading and trailing dashes", () => {
    expect(kebabSlug("  ---hello-world---  ")).toBe("hello-world");
  });

  it("truncates to the configured max", () => {
    expect(kebabSlug("a".repeat(100), 10)).toBe("aaaaaaaaaa");
  });

  it("falls back to 'untitled' when input is purely punctuation", () => {
    expect(kebabSlug("—!!?")).toBe("untitled");
  });
});

describe("buildMetadataTxt", () => {
  it("matches the master-spec layout exactly", () => {
    const out = buildMetadataTxt({
      metadata: {
        youtubeTitle: "Title",
        caption: "Cap",
        hashtags: ["#a", "#b"],
        thumbnailConcept: "concept",
      },
      score: 80,
      scoreBreakdown: {
        hook_strength: 20,
        specificity: 16,
        trend_alignment: 20,
        format_fit: 12,
        shelf_life: 12,
      },
      reasoning: "good",
    });
    expect(out).toMatch(/=== YOUTUBE SHORTS ===\nTitle: Title/);
    expect(out).toMatch(/=== INSTAGRAM \/ TIKTOK CAPTION ===\nCap/);
    expect(out).toMatch(/#a #b/);
    expect(out).toMatch(/=== THUMBNAIL CONCEPT ===\nconcept/);
    expect(out).toMatch(/=== SCORE: 80\/100 ===\nhook_strength 20\/25 · specificity 16\/20 · trend_alignment 20\/25 · format_fit 12\/15 · shelf_life 12\/15/);
    expect(out).toMatch(/Reasoning: good/);
  });
});

describe("handleRenderScript with background music (Setting enable_music=true)", () => {
  let scriptId: string;

  beforeEach(async () => {
    _resetHandlers();
    const seeded = await seedFixture();
    scriptId = seeded.scriptId;
    await db.setting.create({ data: { key: "enable_music", value: "true" } });
    await db.setting.create({ data: { key: "music_gain_db", value: "-18" } });
  });

  it("calls mixAudio with the picked track when the file exists; writes musicPath", async () => {
    const { fsImpl, existing } = makeFakeFs();
    existing.add("/tmp/photo.jpg");
    existing.add("/tmp/clip.mp4");
    existing.add("/tmp/audio.wav");
    existing.add("/tmp/captions.json");
    // The picked track for the seeded beats — pickTrack picks urgent (tone-tied
    // with payoff, urgent wins per the canonical order).
    existing.add("/music/urgent_pulse.mp3");

    const spawnRemotion = vi.fn(async ({ outPath }: { outPath: string }) => {
      existing.add(outPath);
    });
    const probeMedia = vi.fn(async () => ({
      width: 1080,
      height: 1920,
      durationSec: 12.0,
      codec: "h264",
      hasAudio: true,
    }));
    const mixAudio = vi.fn(async ({ outPath }: { outPath: string }) => {
      existing.add(outPath);
    });

    const handler = createRenderScriptHandler({
      buildRenderInput: makeMockBuildRenderInput(scriptId) as never,
      spawnRemotion: spawnRemotion as never,
      probeMedia: probeMedia as never,
      extractThumbnail: vi.fn() as never,
      downloadAsset: vi.fn() as never,
      mixAudio: mixAudio as never,
      musicTrackRoot: "/music",
      fsImpl,
      outputRoot: "/tmp/render-test/output",
    });
    registerHandler("render_script", handler);

    const renderRow = await db.render.findUniqueOrThrow({ where: { scriptId } });
    const job = await db.job.create({
      data: { type: "render_script", status: "queued", targetType: "Render", targetId: renderRow.id, payload: { scriptId } },
    });
    await runJob(job.id);

    expect(mixAudio).toHaveBeenCalledTimes(1);
    const callArg = mixAudio.mock.calls[0]![0] as { musicPath: string; gainDb: number };
    expect(callArg.musicPath).toBe("/music/urgent_pulse.mp3");
    expect(callArg.gainDb).toBe(-18);

    const after = await db.render.findUniqueOrThrow({ where: { scriptId } });
    expect(after.status).toBe("done");
    expect(after.musicPath).toBe("/music/urgent_pulse.mp3");
  });

  it("warns + keeps render done when the track file is missing", async () => {
    const { fsImpl, existing } = makeFakeFs();
    existing.add("/tmp/photo.jpg");
    existing.add("/tmp/clip.mp4");
    // Note: /music/urgent_pulse.mp3 is NOT added — pickTrack still picks it
    // but the existsSync check fails so we skip the mix.

    const spawnRemotion = vi.fn(async ({ outPath }: { outPath: string }) => {
      existing.add(outPath);
    });
    const mixAudio = vi.fn();

    const handler = createRenderScriptHandler({
      buildRenderInput: makeMockBuildRenderInput(scriptId) as never,
      spawnRemotion: spawnRemotion as never,
      probeMedia: vi.fn(async () => ({ width: 1080, height: 1920, durationSec: 12, codec: "h264", hasAudio: true })) as never,
      extractThumbnail: vi.fn() as never,
      downloadAsset: vi.fn() as never,
      mixAudio: mixAudio as never,
      musicTrackRoot: "/music",
      fsImpl,
      outputRoot: "/tmp/render-test/output",
    });
    registerHandler("render_script", handler);

    const renderRow = await db.render.findUniqueOrThrow({ where: { scriptId } });
    const job = await db.job.create({
      data: { type: "render_script", status: "queued", targetType: "Render", targetId: renderRow.id, payload: { scriptId } },
    });
    await runJob(job.id);

    expect(mixAudio).not.toHaveBeenCalled();
    const after = await db.render.findUniqueOrThrow({ where: { scriptId } });
    expect(after.status).toBe("done");
    expect(after.musicPath).toBeNull();
    expect(after.warning ?? "").toMatch(/music track missing/);
  });

  it("on mix failure, render still succeeds and warning is captured", async () => {
    const { fsImpl, existing } = makeFakeFs();
    existing.add("/tmp/photo.jpg");
    existing.add("/tmp/clip.mp4");
    existing.add("/music/urgent_pulse.mp3");

    const spawnRemotion = vi.fn(async ({ outPath }: { outPath: string }) => {
      existing.add(outPath);
    });
    const mixAudio = vi.fn(async () => {
      throw new Error("ffmpeg exited 1: codec lookup failed");
    });

    const handler = createRenderScriptHandler({
      buildRenderInput: makeMockBuildRenderInput(scriptId) as never,
      spawnRemotion: spawnRemotion as never,
      probeMedia: vi.fn(async () => ({ width: 1080, height: 1920, durationSec: 12, codec: "h264", hasAudio: true })) as never,
      extractThumbnail: vi.fn() as never,
      downloadAsset: vi.fn() as never,
      mixAudio: mixAudio as never,
      musicTrackRoot: "/music",
      fsImpl,
      outputRoot: "/tmp/render-test/output",
    });
    registerHandler("render_script", handler);

    const renderRow = await db.render.findUniqueOrThrow({ where: { scriptId } });
    const job = await db.job.create({
      data: { type: "render_script", status: "queued", targetType: "Render", targetId: renderRow.id, payload: { scriptId } },
    });
    await runJob(job.id);

    const after = await db.render.findUniqueOrThrow({ where: { scriptId } });
    expect(after.status).toBe("done");
    expect(after.musicPath).toBeNull();
    expect(after.warning ?? "").toMatch(/music mix failed/);
  });
});

describe("error class metadata", () => {
  it("RemotionRenderError carries exitCode + truncates stderr in message", () => {
    const err = new RemotionRenderError(127, "boom");
    expect(err.name).toBe("RemotionRenderError");
    expect(err.exitCode).toBe(127);
  });

  it("EmptyMp4Error carries size", () => {
    expect(new EmptyMp4Error(100).size).toBe(100);
  });

  it("DiskLowError formats free MiB", () => {
    expect(new DiskLowError(123 * 1024 * 1024).message).toMatch(/disk_low/);
  });
});
