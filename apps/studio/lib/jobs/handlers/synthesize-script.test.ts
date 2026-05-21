import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "node:path";
import { db } from "../../db";
import { runJob, registerHandler, _resetHandlers } from "../runner";
import {
  createSynthesizeScriptHandler,
  VoiceModelMissingError,
  WhisperModelMissingError,
  DiskLowError,
} from "./synthesize-script";

/** Build an in-memory 44-byte WAV header for a fake Piper output. */
function fakeWavBuffer(durationSec: number): Buffer {
  const sampleRate = 22050;
  const bitsPerSample = 16;
  const channels = 1;
  const bytesPerSample = bitsPerSample / 8;
  const dataBytes = Math.round(sampleRate * channels * bytesPerSample * durationSec);
  const total = 44 + dataBytes;
  const buf = Buffer.alloc(total);
  buf.write("RIFF", 0, 4, "ascii");
  buf.writeUInt32LE(total - 8, 4);
  buf.write("WAVE", 8, 4, "ascii");
  buf.write("fmt ", 12, 4, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buf.writeUInt16LE(channels * bytesPerSample, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write("data", 36, 4, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}

function makeFakeFs(opts: { wavBuf: Buffer; existing?: Set<string>; freeBytes?: number | null } = { wavBuf: fakeWavBuffer(2) }) {
  const writes = new Map<string, string>();
  const defaults = [
    path.resolve("assets/voices/en_US-ryan-high.onnx"),
    path.resolve("assets/whisper/ggml-base.en.bin"),
    "/mock/voice.onnx",
    "/mock/whisper.bin",
  ];
  const existing = new Set<string>(opts.existing ?? defaults);
  return {
    writes,
    fsImpl: {
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async (p: string, data: string) => {
        writes.set(p, data);
      }),
      readFile: vi.fn(async (_p: string) => opts.wavBuf),
      stat: vi.fn(async (_p: string) => ({ size: opts.wavBuf.length })),
      existsSync: (p: string) => existing.has(p),
      freeBytes: (_p: string) => (opts.freeBytes === undefined ? 10 * 1024 * 1024 * 1024 : opts.freeBytes),
    },
  };
}

describe("handleSynthesizeScript", () => {
  let bookId: string;
  let chapterId: string;
  let ideaId: string;
  let scriptId: string;

  beforeEach(async () => {
    _resetHandlers();
    await db.apiUsage.deleteMany();
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
    bookId = book.id;
    const chapter = await db.chapter.create({
      data: {
        bookId,
        title: "Chapter 1",
        orderIndex: 0,
        startPage: 0,
        endPage: 0,
        rawText: "rawtext",
        status: "extracted",
      },
    });
    chapterId = chapter.id;
    const idea = await db.idea.create({
      data: {
        chapterId,
        title: "Compound interest is the eighth wonder",
        summary: "small early contributions outperform large late ones",
        targetLengthSec: 30,
        status: "approved",
      },
    });
    ideaId = idea.id;
    const script = await db.script.create({
      data: {
        ideaId,
        hook: "Most people miss the real lever of wealth",
        body: "It is not income. It is time, multiplied by consistency.",
        cta: "Start now, even if it is small.",
        visualBeats: [],
        metadata: {},
        status: "draft",
      },
    });
    scriptId = script.id;
  });

  it("happy path: writes Render row with audio, captions, duration, sizes, and status=done", async () => {
    const wav = fakeWavBuffer(2.5);
    const { fsImpl, writes } = makeFakeFs({ wavBuf: wav });
    const synth = vi.fn(async () => ({ outputPath: "audio.wav", durationMs: 1234 }));
    const transcribe = vi.fn(async () => ({
      words: [
        { word: "compound", start: 0, end: 0.5 },
        { word: "interest", start: 0.5, end: 1.0 },
      ],
    }));

    const handler = createSynthesizeScriptHandler({
      synthesize: synth,
      transcribe,
      fsImpl,
      outputRoot: "/tmp/synth-test/output",
      resolveVoiceModel: async () => "/mock/voice.onnx",
      whisperModelPath: "/mock/whisper.bin",
    });
    registerHandler("synthesize_script", handler);

    const job = await db.job.create({
      data: {
        type: "synthesize_script",
        status: "queued",
        targetType: "Script",
        targetId: scriptId,
        payload: { scriptId },
      },
    });
    await runJob(job.id);

    const after = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status, after.error ?? "").toBe("completed");
    expect(after.progress).toBe(100);

    const render = await db.render.findUniqueOrThrow({ where: { scriptId } });
    expect(render.status).toBe("done");
    expect(render.progress).toBe(100);
    expect(render.audioPath).toMatch(/audio\.wav$/);
    expect(render.captionsPath).toMatch(/captions\.json$/);
    expect(render.durationSec).toBeCloseTo(2.5, 1);
    expect(render.fileSizeMB).toBeGreaterThan(0);
    expect(render.warning).toBeNull();
    expect(render.completedAt).not.toBeNull();

    // script.txt should have been written with sentence-joined text
    const scriptTxt = Array.from(writes.entries()).find(([p]) => p.endsWith("script.txt"));
    expect(scriptTxt).toBeDefined();
    expect(scriptTxt![1]).toMatch(/Most people miss/);
    expect(scriptTxt![1]).toMatch(/Start now/);
    // No accidental ". ." double-period seam
    expect(scriptTxt![1]).not.toMatch(/\.\s*\./);

    expect(synth).toHaveBeenCalledTimes(1);
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it("falls back to evenly-distributed words and sets warning when whisper returns 0 words", async () => {
    const wav = fakeWavBuffer(3.0);
    const { fsImpl, writes } = makeFakeFs({ wavBuf: wav });
    const synth = vi.fn(async () => ({ outputPath: "a.wav", durationMs: 1 }));
    const transcribe = vi.fn(async () => ({ words: [] as never[] }));

    const handler = createSynthesizeScriptHandler({
      synthesize: synth,
      transcribe,
      fsImpl,
      outputRoot: "/tmp/synth-test/output",
      resolveVoiceModel: async () => "/mock/voice.onnx",
      whisperModelPath: "/mock/whisper.bin",
    });
    registerHandler("synthesize_script", handler);

    const job = await db.job.create({
      data: {
        type: "synthesize_script",
        status: "queued",
        targetType: "Script",
        targetId: scriptId,
        payload: { scriptId },
      },
    });
    await runJob(job.id);

    const render = await db.render.findUniqueOrThrow({ where: { scriptId } });
    expect(render.status).toBe("done");
    expect(render.warning).toBe("captions estimated");

    // captions.json should now contain an even-distribution payload
    const capJsonEntry = Array.from(writes.entries()).find(([p]) => p.endsWith("captions.json"));
    expect(capJsonEntry).toBeDefined();
    const parsed = JSON.parse(capJsonEntry![1]);
    expect(parsed.words.length).toBeGreaterThan(0);
    const first = parsed.words[0];
    const last = parsed.words.at(-1);
    expect(first.start).toBe(0);
    expect(last.end).toBeCloseTo(3.0, 5);
  });

  it("throws VoiceModelMissingError when the voice .onnx is missing on disk", async () => {
    const { fsImpl } = makeFakeFs({
      wavBuf: fakeWavBuffer(1),
      existing: new Set([path.resolve("assets/whisper/ggml-base.en.bin")]),
    });
    const synth = vi.fn(async () => ({ outputPath: "a.wav", durationMs: 1 }));
    const transcribe = vi.fn(async () => ({ words: [] }));

    const handler = createSynthesizeScriptHandler({
      synthesize: synth,
      transcribe,
      fsImpl,
      outputRoot: "/tmp/synth-test/output",
    });
    registerHandler("synthesize_script", handler);

    const job = await db.job.create({
      data: { type: "synthesize_script", status: "queued", targetType: "Script", targetId: scriptId, payload: { scriptId } },
    });
    await runJob(job.id);

    const after = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe("failed");
    expect(after.error).toMatch(/Voice model en_US-ryan-high not found/);
    expect(after.error).toMatch(/pnpm setup:piper/);
    expect(synth).not.toHaveBeenCalled();
  });

  it("throws WhisperModelMissingError when whisper bin is missing", async () => {
    const { fsImpl } = makeFakeFs({
      wavBuf: fakeWavBuffer(1),
      existing: new Set([path.resolve("assets/voices/en_US-ryan-high.onnx")]),
    });

    const handler = createSynthesizeScriptHandler({
      synthesize: vi.fn() as never,
      transcribe: vi.fn() as never,
      fsImpl,
      outputRoot: "/tmp/synth-test/output",
    });
    registerHandler("synthesize_script", handler);

    const job = await db.job.create({
      data: { type: "synthesize_script", status: "queued", targetType: "Script", targetId: scriptId, payload: { scriptId } },
    });
    await runJob(job.id);

    const after = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe("failed");
    expect(after.error).toMatch(/Whisper model not found/);
    expect(after.error).toMatch(/pnpm setup:whisper/);
  });

  it("refuses with disk_low when free space < 1 GB", async () => {
    const { fsImpl } = makeFakeFs({ wavBuf: fakeWavBuffer(1), freeBytes: 100 * 1024 * 1024 });
    const handler = createSynthesizeScriptHandler({
      synthesize: vi.fn() as never,
      transcribe: vi.fn() as never,
      fsImpl,
      outputRoot: "/tmp/synth-test/output",
      resolveVoiceModel: async () => "/mock/voice.onnx",
      whisperModelPath: "/mock/whisper.bin",
    });
    registerHandler("synthesize_script", handler);

    const job = await db.job.create({
      data: { type: "synthesize_script", status: "queued", targetType: "Script", targetId: scriptId, payload: { scriptId } },
    });
    await runJob(job.id);

    const after = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe("failed");
    expect(after.error).toMatch(/disk_low/);
  });

  it("overwrites prior Render row on re-run (idempotent regenerate)", async () => {
    // Seed a prior render row with stale paths
    await db.render.create({
      data: {
        scriptId,
        audioPath: "/old/audio.wav",
        captionsPath: "/old/captions.json",
        status: "failed",
        progress: 0,
        error: "old error",
      },
    });

    const { fsImpl } = makeFakeFs({ wavBuf: fakeWavBuffer(1) });
    const handler = createSynthesizeScriptHandler({
      synthesize: vi.fn(async () => ({ outputPath: "a", durationMs: 1 })),
      transcribe: vi.fn(async () => ({ words: [{ word: "x", start: 0, end: 0.5 }] })),
      fsImpl,
      outputRoot: "/tmp/synth-test/output",
      resolveVoiceModel: async () => "/mock/voice.onnx",
      whisperModelPath: "/mock/whisper.bin",
    });
    registerHandler("synthesize_script", handler);

    const job = await db.job.create({
      data: { type: "synthesize_script", status: "queued", targetType: "Script", targetId: scriptId, payload: { scriptId } },
    });
    await runJob(job.id);

    const render = await db.render.findUniqueOrThrow({ where: { scriptId } });
    expect(render.status).toBe("done");
    expect(render.audioPath).not.toBe("/old/audio.wav");
    expect(render.error).toBeNull();
  });

  it("monotonically advances progress through expected stages", async () => {
    const seen: number[] = [];
    const { fsImpl } = makeFakeFs({ wavBuf: fakeWavBuffer(1) });
    const inner = createSynthesizeScriptHandler({
      synthesize: vi.fn(async () => ({ outputPath: "a", durationMs: 1 })),
      transcribe: vi.fn(async () => ({ words: [{ word: "x", start: 0, end: 0.5 }] })),
      fsImpl,
      outputRoot: "/tmp/synth-test/output",
      resolveVoiceModel: async () => "/mock/voice.onnx",
      whisperModelPath: "/mock/whisper.bin",
    });
    registerHandler("synthesize_script", async (payload, ctx) => {
      const wrap = {
        ...ctx,
        updateProgress: async (n: number) => {
          seen.push(n);
          await ctx.updateProgress(n);
        },
      };
      return inner(payload as never, wrap);
    });

    const job = await db.job.create({
      data: { type: "synthesize_script", status: "queued", targetType: "Script", targetId: scriptId, payload: { scriptId } },
    });
    await runJob(job.id);

    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]!);
    }
    expect(seen).toContain(5);
    expect(seen).toContain(50);
    expect(seen).toContain(55);
    expect(seen).toContain(95);
    expect(seen[seen.length - 1]).toBe(100);
  });

  it("error classes carry actionable metadata", () => {
    const v = new VoiceModelMissingError("en_US-amy-medium", "/path/voice.onnx");
    expect(v.message).toContain("en_US-amy-medium");
    expect(v.message).toContain("pnpm setup:piper");
    expect(v.voice).toBe("en_US-amy-medium");

    const w = new WhisperModelMissingError("/path/whisper.bin");
    expect(w.message).toContain("pnpm setup:whisper");

    const d = new DiskLowError(123 * 1024 * 1024);
    expect(d.message).toContain("disk_low");
  });
});
