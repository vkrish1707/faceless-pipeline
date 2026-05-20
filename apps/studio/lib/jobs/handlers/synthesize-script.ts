import { promises as fsPromises, statfsSync, existsSync } from "node:fs";
import path from "node:path";
import {
  synthesize as defaultSynthesize,
  type PiperOpts,
} from "@studio/tts";
import {
  transcribe as defaultTranscribe,
  type CaptionsResult,
} from "@studio/captions";
import { db as defaultDb } from "../../db";
import { parseWavHeader } from "../../audio/wav";
import type { JobHandler } from "../types";

export type SynthesizeScriptPayload = { scriptId: string };
export type SynthesizeScriptResult = {
  renderId: string;
  audioPath: string;
  captionsPath: string;
  durationSec: number;
  fileSizeMB: number;
  wordCount: number;
  estimatedCaptions: boolean;
};

export const VOICE_ALLOWLIST = ["en_US-ryan-high", "en_US-amy-medium"] as const;
export const DEFAULT_VOICE = "en_US-ryan-high";
export const WHISPER_MODEL_PATH = "assets/whisper/ggml-base.en.bin";
export const VOICE_DIR = "assets/voices";

export class VoiceModelMissingError extends Error {
  voice: string;
  expectedPath: string;
  constructor(voice: string, expectedPath: string) {
    super(
      `Voice model ${voice} not found at ${expectedPath}. Run \`pnpm setup:piper\` to install it.`
    );
    this.name = "VoiceModelMissingError";
    this.voice = voice;
    this.expectedPath = expectedPath;
  }
}

export class WhisperModelMissingError extends Error {
  expectedPath: string;
  constructor(expectedPath: string) {
    super(
      `Whisper model not found at ${expectedPath}. Run \`pnpm setup:whisper\` to install it.`
    );
    this.name = "WhisperModelMissingError";
    this.expectedPath = expectedPath;
  }
}

export class DiskLowError extends Error {
  freeBytes: number;
  constructor(freeBytes: number) {
    super(`disk_low: only ${(freeBytes / (1024 * 1024)).toFixed(0)} MiB free`);
    this.name = "DiskLowError";
    this.freeBytes = freeBytes;
  }
}

type SynthesizeFn = (text: string, opts: PiperOpts) => Promise<{ outputPath: string; durationMs: number }>;
type TranscribeFn = (
  audioPath: string,
  opts: { modelPath: string; outputJsonPath: string }
) => Promise<CaptionsResult>;

type ResolveVoiceModel = (deps: { db: typeof defaultDb; fsImpl: FsImpl; outputRoot: string }) => Promise<string>;

type FsImpl = {
  mkdir: (p: string, opts: { recursive: true }) => Promise<unknown>;
  writeFile: (p: string, data: string) => Promise<unknown>;
  readFile: (p: string) => Promise<Buffer>;
  stat: (p: string) => Promise<{ size: number }>;
  existsSync: (p: string) => boolean;
  /** Returns free bytes on the volume containing path, or null if unsupported. */
  freeBytes: (p: string) => number | null;
};

const defaultFs: FsImpl = {
  mkdir: (p, opts) => fsPromises.mkdir(p, opts),
  writeFile: (p, data) => fsPromises.writeFile(p, data),
  readFile: (p) => fsPromises.readFile(p),
  stat: (p) => fsPromises.stat(p),
  existsSync,
  freeBytes: (p) => {
    try {
      // statfsSync is available in Node 18+.
      const st = statfsSync(p);
      return Number(st.bavail) * Number(st.bsize);
    } catch {
      return null;
    }
  },
};

const DISK_MIN_BYTES = 1024 * 1024 * 1024; // 1 GiB

type Deps = {
  db?: typeof defaultDb;
  synthesize?: SynthesizeFn;
  transcribe?: TranscribeFn;
  resolveVoiceModel?: ResolveVoiceModel;
  fsImpl?: FsImpl;
  outputRoot?: string;
  voiceDir?: string;
  whisperModelPath?: string;
  diskMinBytes?: number;
};

function composeText(parts: { hook: string; body: string; cta: string }): string {
  return [parts.hook, parts.body, parts.cta]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(". ")
    .replace(/\.\s*\./g, ".");
}

function evenlyDistributedWords(text: string, durationSec: number): { word: string; start: number; end: number }[] {
  const arr = text.split(/\s+/).filter(Boolean);
  if (arr.length === 0) return [];
  const slot = durationSec / arr.length;
  return arr.map((word, i) => ({
    word,
    start: i * slot,
    end: (i + 1) * slot,
  }));
}

async function defaultResolveVoiceModel(deps: { db: typeof defaultDb; fsImpl: FsImpl; outputRoot: string }): Promise<string> {
  let row = await deps.db.setting.findUnique({ where: { key: "default_voice" } });
  if (!row) {
    row = await deps.db.setting.upsert({
      where: { key: "default_voice" },
      update: {},
      create: { key: "default_voice", value: DEFAULT_VOICE },
    });
  }
  const voice = row.value;
  const expectedPath = path.resolve(VOICE_DIR, `${voice}.onnx`);
  if (!deps.fsImpl.existsSync(expectedPath)) {
    throw new VoiceModelMissingError(voice, expectedPath);
  }
  return expectedPath;
}

export function createSynthesizeScriptHandler(
  deps: Deps = {}
): JobHandler<SynthesizeScriptPayload, SynthesizeScriptResult> {
  const db = deps.db ?? defaultDb;
  const synthesizeFn = deps.synthesize ?? (defaultSynthesize as SynthesizeFn);
  const transcribeFn = deps.transcribe ?? (defaultTranscribe as TranscribeFn);
  const resolveVoiceModel = deps.resolveVoiceModel ?? defaultResolveVoiceModel;
  const fsImpl = deps.fsImpl ?? defaultFs;
  const outputRoot = deps.outputRoot ?? path.resolve("output");
  const whisperModelPath = deps.whisperModelPath ?? path.resolve(WHISPER_MODEL_PATH);
  const diskMinBytes = deps.diskMinBytes ?? DISK_MIN_BYTES;

  return async function handleSynthesizeScript(payload, ctx) {
    // Pre-flight: disk space check (best-effort; null result means OS doesn't
    // support statfs, in which case we don't block).
    const free = fsImpl.freeBytes(outputRoot);
    if (free !== null && free < diskMinBytes) {
      throw new DiskLowError(free);
    }

    // Load script + idea (for title context in logs / future use).
    const script = await db.script.findUniqueOrThrow({
      where: { id: payload.scriptId },
      include: { idea: true },
    });

    // Resolve voice model — throws VoiceModelMissingError if absent.
    const modelPath = await resolveVoiceModel({ db, fsImpl, outputRoot });

    // Confirm whisper model is present too, with the same actionable error.
    if (!fsImpl.existsSync(whisperModelPath)) {
      throw new WhisperModelMissingError(whisperModelPath);
    }

    const scriptDir = path.join(outputRoot, payload.scriptId);
    await fsImpl.mkdir(scriptDir, { recursive: true });

    const text = composeText(script);
    const scriptTxtPath = path.join(scriptDir, "script.txt");
    await fsImpl.writeFile(scriptTxtPath, text);

    const audioPath = path.join(scriptDir, "audio.wav");
    const captionsPath = path.join(scriptDir, "captions.json");

    await ctx.updateProgress(5);

    await synthesizeFn(text, { modelPath, outputPath: audioPath });

    await ctx.updateProgress(50);

    // Read WAV header for duration + size BEFORE transcription so we can use
    // it for the fallback if whisper returns zero words.
    const audioStat = await fsImpl.stat(audioPath);
    const headerBuf = (await fsImpl.readFile(audioPath)).subarray(0, 44);
    const header = parseWavHeader(headerBuf, audioStat.size);
    const durationSec = header.durationSec;
    const fileSizeMB = audioStat.size / (1024 * 1024);

    await ctx.updateProgress(55);

    const captions = await transcribeFn(audioPath, {
      modelPath: whisperModelPath,
      outputJsonPath: captionsPath,
    });

    await ctx.updateProgress(95);

    let estimatedCaptions = false;
    let wordCount = captions.words.length;
    if (wordCount === 0) {
      const fallback = evenlyDistributedWords(text, durationSec);
      await fsImpl.writeFile(
        captionsPath,
        JSON.stringify({ words: fallback }, null, 2)
      );
      estimatedCaptions = true;
      wordCount = fallback.length;
    }

    // Upsert Render row (unique on scriptId).
    const render = await db.render.upsert({
      where: { scriptId: payload.scriptId },
      update: {
        audioPath,
        captionsPath,
        durationSec,
        fileSizeMB,
        status: "done",
        progress: 100,
        error: null,
        warning: estimatedCaptions ? "captions estimated" : null,
        completedAt: new Date(),
      },
      create: {
        scriptId: payload.scriptId,
        audioPath,
        captionsPath,
        durationSec,
        fileSizeMB,
        status: "done",
        progress: 100,
        error: null,
        warning: estimatedCaptions ? "captions estimated" : null,
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });

    await ctx.updateProgress(100);

    return {
      renderId: render.id,
      audioPath,
      captionsPath,
      durationSec,
      fileSizeMB,
      wordCount,
      estimatedCaptions,
    };
  };
}

export const handleSynthesizeScript = createSynthesizeScriptHandler();
