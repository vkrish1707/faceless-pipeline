import {
  promises as fsPromises,
  statfsSync,
  existsSync,
  type Stats,
} from "node:fs";
import path from "node:path";
import { spawn as defaultSpawn, type ChildProcess } from "node:child_process";
import pLimit from "p-limit";
import {
  downloadAsset as defaultDownloadAsset,
  type DownloadOpts,
  type DownloadResult,
} from "@studio/assets";
import { db as defaultDb } from "../../db";
import { buildRenderInput as defaultBuildRenderInput, MissingPrerequisiteError } from "../../render/build-input";
import { probeMedia as defaultProbeMedia, type ProbeResult } from "../../probe/ffprobe";
import { extractThumbnail as defaultExtractThumbnail } from "../../probe/thumbnail";
import { mixAudio as defaultMixAudio } from "../../music/mixAudio";
import { pickTrack as defaultPickTrack } from "../../music/pickTrack";
import { emitRender } from "../emit";
import type { JobHandler } from "../types";
import type { RenderInput } from "@remotion-pkg/data/types";

export type RenderScriptPayload = {
  scriptId: string;
  /**
   * If true, skip buildRenderInput and load the previously-saved
   * render-input.json from `<outputRoot>/<scriptId>/render-input.json`.
   * Used by the `rerender` route after a single asset has been swapped.
   */
  reuseInput?: boolean;
};

export type RenderScriptResult = {
  renderId: string;
  videoPath: string;
  bundleDir: string;
  durationSec: number;
  fileSizeMB: number;
};

export class DiskLowError extends Error {
  freeBytes: number;
  constructor(freeBytes: number) {
    super(`disk_low: only ${(freeBytes / (1024 * 1024)).toFixed(0)} MiB free`);
    this.name = "DiskLowError";
    this.freeBytes = freeBytes;
  }
}

export class RemotionRenderError extends Error {
  exitCode: number | null;
  constructor(exitCode: number | null, stderr: string) {
    super(`remotion exited ${exitCode}: ${stderr.slice(0, 4096)}`);
    this.name = "RemotionRenderError";
    this.exitCode = exitCode;
  }
}

export class EmptyMp4Error extends Error {
  size: number;
  constructor(size: number) {
    super(`remotion produced empty mp4 (${size} bytes)`);
    this.name = "EmptyMp4Error";
    this.size = size;
  }
}

type SpawnFn = (
  cmd: string,
  args: ReadonlyArray<string>,
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv }
) => ChildProcess;

type ProbeFn = typeof defaultProbeMedia;
type ExtractThumbnailFn = typeof defaultExtractThumbnail;
type DownloadFn = (opts: DownloadOpts) => Promise<DownloadResult>;

type FsImpl = {
  mkdir: (p: string, opts: { recursive: true }) => Promise<unknown>;
  writeFile: (p: string, data: string) => Promise<unknown>;
  readFile: (p: string, encoding?: BufferEncoding) => Promise<Buffer | string>;
  copyFile: (from: string, to: string) => Promise<unknown>;
  stat: (p: string) => Promise<Pick<Stats, "size">>;
  existsSync: (p: string) => boolean;
  freeBytes: (p: string) => number | null;
};

const defaultFs: FsImpl = {
  mkdir: (p, opts) => fsPromises.mkdir(p, opts),
  writeFile: (p, data) => fsPromises.writeFile(p, data),
  readFile: (p, encoding) =>
    encoding ? fsPromises.readFile(p, encoding) : fsPromises.readFile(p),
  copyFile: (from, to) => fsPromises.copyFile(from, to),
  stat: (p) => fsPromises.stat(p),
  existsSync,
  freeBytes: (p) => {
    try {
      const st = statfsSync(p);
      return Number(st.bavail) * Number(st.bsize);
    } catch {
      return null;
    }
  },
};

type SpawnRemotionFn = (args: {
  entry: string;
  composition: string;
  outPath: string;
  propsPath: string;
  spawnImpl: SpawnFn;
  env?: NodeJS.ProcessEnv;
}) => Promise<void>;

type MixAudioFn = typeof defaultMixAudio;
type PickTrackFn = typeof defaultPickTrack;

type Deps = {
  db?: typeof defaultDb;
  buildRenderInput?: typeof defaultBuildRenderInput;
  downloadAsset?: DownloadFn;
  spawnRemotion?: SpawnRemotionFn;
  probeMedia?: ProbeFn;
  extractThumbnail?: ExtractThumbnailFn;
  fsImpl?: FsImpl;
  outputRoot?: string;
  remotionEntry?: string;
  /** App-wide minimum free disk space (default 2 GiB). */
  diskMinBytes?: number;
  /** Concurrency for lazy asset downloads. */
  downloadConcurrency?: number;
  /** Background-music mix (phase 7). */
  mixAudio?: MixAudioFn;
  pickTrack?: PickTrackFn;
  /** Override the music asset root for tests. */
  musicTrackRoot?: string;
};

const DEFAULT_DISK_MIN_BYTES = 2 * 1024 * 1024 * 1024;
const MIN_MP4_BYTES = 100 * 1024;
const COMPOSITION_ID = "Video";
const REMOTION_ENTRY = "packages/remotion/src/index.ts";

/**
 * Default `spawnRemotion` invokes `npx remotion render <entry> <comp> <out>
 *   --props=<json> --concurrency=4 --x264-preset=fast`. Captures stderr into
 * the rejection's message so the orchestrator can persist it to Render.error.
 */
async function defaultSpawnRemotion(args: {
  entry: string;
  composition: string;
  outPath: string;
  propsPath: string;
  spawnImpl: SpawnFn;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const argv = [
    "remotion",
    "render",
    args.entry,
    args.composition,
    args.outPath,
    `--props=${args.propsPath}`,
    "--concurrency=4",
    "--x264-preset=fast",
  ];
  await new Promise<void>((resolveP, rejectP) => {
    const env = { REMOTION_GL: "angle", ...process.env, ...args.env };
    const proc = args.spawnImpl("npx", argv, { env });
    let stderr = "";
    proc.stderr?.on("data", (d) => (stderr += d.toString()));
    proc.on("error", rejectP);
    proc.on("close", (code) => {
      if (code === 0) resolveP();
      else rejectP(new RemotionRenderError(code ?? null, stderr));
    });
  });
}

export function kebabSlug(input: string, max = 40): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (slug || "untitled").slice(0, max);
}

export function buildMetadataTxt(args: {
  metadata: { youtubeTitle: string; caption: string; hashtags: string[]; thumbnailConcept: string };
  score: number | null;
  scoreBreakdown: Record<string, number> | null;
  reasoning: string;
}): string {
  const { metadata, score, scoreBreakdown, reasoning } = args;
  const hashLine = metadata.hashtags.join(" ");
  const breakdownStr = scoreBreakdown
    ? `hook_strength ${scoreBreakdown.hook_strength ?? 0}/25 · specificity ${scoreBreakdown.specificity ?? 0}/20 · trend_alignment ${scoreBreakdown.trend_alignment ?? 0}/25 · format_fit ${scoreBreakdown.format_fit ?? 0}/15 · shelf_life ${scoreBreakdown.shelf_life ?? 0}/15`
    : "";
  const scoreLine = score == null ? "" : `=== SCORE: ${score}/100 ===\n${breakdownStr}`;
  return [
    "=== YOUTUBE SHORTS ===",
    `Title: ${metadata.youtubeTitle}`,
    "",
    "=== INSTAGRAM / TIKTOK CAPTION ===",
    metadata.caption,
    "",
    hashLine,
    "",
    "=== THUMBNAIL CONCEPT ===",
    metadata.thumbnailConcept,
    "",
    scoreLine,
    reasoning ? "" : "",
    reasoning ? `Reasoning: ${reasoning}` : "",
    "",
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n");
}

export function createRenderScriptHandler(
  deps: Deps = {}
): JobHandler<RenderScriptPayload, RenderScriptResult> {
  const db = deps.db ?? defaultDb;
  const buildRenderInput = deps.buildRenderInput ?? defaultBuildRenderInput;
  const downloadAsset = deps.downloadAsset ?? (defaultDownloadAsset as DownloadFn);
  const probeMedia = deps.probeMedia ?? defaultProbeMedia;
  const extractThumbnail = deps.extractThumbnail ?? defaultExtractThumbnail;
  const spawnRemotion = deps.spawnRemotion ?? defaultSpawnRemotion;
  const fsImpl = deps.fsImpl ?? defaultFs;
  const outputRoot = deps.outputRoot ?? path.resolve("output");
  const remotionEntry = deps.remotionEntry ?? path.resolve(REMOTION_ENTRY);
  const diskMinBytes = deps.diskMinBytes ?? DEFAULT_DISK_MIN_BYTES;
  const downloadConcurrency = deps.downloadConcurrency ?? 4;
  const mixAudio = deps.mixAudio ?? defaultMixAudio;
  const pickTrack = deps.pickTrack ?? defaultPickTrack;
  const musicTrackRoot = deps.musicTrackRoot;

  return async function handleRenderScript(payload, ctx) {
    const scriptId = payload.scriptId;

    // Stage 0 → 5: build (or load) the props JSON and pre-flight disk space.
    const free = fsImpl.freeBytes(outputRoot);
    if (free !== null && free < diskMinBytes) {
      throw new DiskLowError(free);
    }

    const stagingDir = path.join(outputRoot, scriptId);
    await fsImpl.mkdir(stagingDir, { recursive: true });
    const renderInputPath = path.join(stagingDir, "render-input.json");

    let input: RenderInput;
    if (payload.reuseInput) {
      const raw = await fsImpl.readFile(renderInputPath, "utf8");
      input = JSON.parse(typeof raw === "string" ? raw : raw.toString()) as RenderInput;
    } else {
      input = await buildRenderInput({ scriptId });
      await fsImpl.writeFile(renderInputPath, JSON.stringify(input, null, 2));
    }

    await ctx.updateProgress(5);

    // Lookup the Render row to update progress + status as we go.
    const render = await db.render.findUniqueOrThrow({ where: { scriptId } });

    // Stage 5 → 25: lazy-download full assets if not on disk.
    const limit = pLimit(downloadConcurrency);
    let downloadedCount = 0;
    const total = input.visualBeats.length;
    await Promise.all(
      input.visualBeats.map((beat) =>
        limit(async () => {
          if (!beat.assetPath) return;
          if (fsImpl.existsSync(beat.assetPath)) return;
          // We only have an absolute path on disk; the Asset row also tracks
          // sourceUrl, but the cleanest lazy-download is to look it up.
          const asset = await db.asset.findFirst({
            where: { localPath: { contains: path.basename(beat.assetPath) } },
          });
          if (!asset?.sourceUrl) {
            // Nothing else we can do — let the Remotion render fail with a
            // clear "file not found" instead of dying silently here.
            return;
          }
          await downloadAsset({
            url: asset.sourceUrl,
            destDir: path.dirname(beat.assetPath),
          });
          downloadedCount += 1;
          await ctx.updateProgress(5 + Math.min(20, Math.floor((downloadedCount / Math.max(1, total)) * 20)));
        })
      )
    );

    await ctx.updateProgress(25);

    // Stage 25 → 90: spawn Remotion.
    await db.render.update({
      where: { id: render.id },
      data: { status: "render", progress: 25, error: null, startedAt: new Date() },
    });
    emitRender({ renderId: render.id, status: "render", progress: 25 });

    // The Remotion CLI writes its output to a temp path under stagingDir, then
    // we copy it into the bundle dir. This keeps the prior render available
    // while a re-render runs.
    const stagingVideoPath = path.join(stagingDir, "video.mp4");
    try {
      await spawnRemotion({
        entry: remotionEntry,
        composition: COMPOSITION_ID,
        outPath: stagingVideoPath,
        propsPath: renderInputPath,
        spawnImpl: defaultSpawn as SpawnFn,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await db.render.update({
        where: { id: render.id },
        data: { status: "failed", error: detail.slice(0, 4000), completedAt: new Date() },
      });
      emitRender({ renderId: render.id, status: "failed", progress: 25, error: detail.slice(0, 4000) });
      throw err;
    }

    // Verify the MP4 is non-empty.
    const videoStat = await fsImpl.stat(stagingVideoPath);
    if (videoStat.size < MIN_MP4_BYTES) {
      const detail = `remotion produced empty mp4 (${videoStat.size} bytes)`;
      await db.render.update({
        where: { id: render.id },
        data: { status: "failed", error: detail, completedAt: new Date() },
      });
      emitRender({ renderId: render.id, status: "failed", progress: 25, error: detail });
      throw new EmptyMp4Error(videoStat.size);
    }

    // Optional: background-music mix. Reads Setting("enable_music") + the
    // user-configured gain. Mix failures are non-fatal — we capture stderr
    // into Render.warning and keep the un-mixed video.
    let mixedMusicPath: string | null = null;
    const enableMusicRow = await db.setting.findUnique({ where: { key: "enable_music" } });
    if (enableMusicRow?.value === "true") {
      const gainRow = await db.setting.findUnique({ where: { key: "music_gain_db" } });
      const gainDb = gainRow ? Number.parseFloat(gainRow.value) : -18;
      const beats = (input.visualBeats as ReadonlyArray<{ tone?: string }>) ?? [];
      const picked = pickTrack(beats, musicTrackRoot ? { trackRoot: musicTrackRoot } : {});
      if (!fsImpl.existsSync(picked.path)) {
        await db.render.update({
          where: { id: render.id },
          data: { warning: `music track missing: ${picked.path}` },
        });
      } else {
        const mixedPath = path.join(stagingDir, "video.mixed.mp4");
        try {
          await mixAudio({
            videoPath: stagingVideoPath,
            musicPath: picked.path,
            outPath: mixedPath,
            gainDb,
          });
          // Atomic rename — replace the staging video with the mixed file.
          await fsImpl.copyFile(mixedPath, stagingVideoPath);
          mixedMusicPath = picked.path;
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          await db.render.update({
            where: { id: render.id },
            data: { warning: `music mix failed: ${detail.slice(0, 300)}` },
          });
          // Keep the original un-mixed video — render still succeeds.
        }
      }
    }

    await ctx.updateProgress(90);

    // Stage 90 → 95: probe + thumbnail.
    await db.render.update({
      where: { id: render.id },
      data: { status: "bundle", progress: 90 },
    });
    emitRender({ renderId: render.id, status: "bundle", progress: 90 });

    let probe: ProbeResult;
    try {
      probe = await probeMedia(stagingVideoPath);
    } catch (err) {
      // Probe failures are non-fatal — trust the frame count + width/height
      // from the input. We still warn so the operator notices the missing
      // ffprobe.
      probe = {
        width: input.width,
        height: input.height,
        durationSec: input.durationFrames / input.fps,
        codec: "h264",
        hasAudio: true,
      };
      await db.render.update({
        where: { id: render.id },
        data: { warning: `ffprobe failed: ${(err as Error).message.slice(0, 200)}` },
      });
    }

    // Resolve final bundle directory. Slug from idea title + script id suffix
    // so concurrent scripts with the same idea title don't collide.
    const script = await db.script.findUniqueOrThrow({
      where: { id: scriptId },
      include: { idea: { include: { chapter: { include: { book: true } } } } },
    });
    const bookSlug = kebabSlug(script.idea.chapter.book.title);
    const chapterSlug = kebabSlug(script.idea.chapter.title);
    const scriptSlug = kebabSlug(script.idea.title);
    const bundleDir = path.join(outputRoot, bookSlug, chapterSlug, `${scriptSlug}-${scriptId.slice(-8)}`);
    const debugDir = path.join(bundleDir, "debug");
    await fsImpl.mkdir(debugDir, { recursive: true });

    const finalVideoPath = path.join(bundleDir, "video.mp4");
    const thumbnailPath = path.join(bundleDir, "thumbnail.jpg");
    const metadataPath = path.join(bundleDir, "metadata.txt");

    // Move the freshly-rendered MP4 into the bundle dir.
    await fsImpl.copyFile(stagingVideoPath, finalVideoPath);

    try {
      await extractThumbnail({
        srcPath: finalVideoPath,
        outPath: thumbnailPath,
        atSec: 1,
      });
    } catch (err) {
      // Warn-only — the bundle is still useful without a thumbnail.
      await db.render.update({
        where: { id: render.id },
        data: { warning: `thumbnail failed: ${(err as Error).message.slice(0, 200)}` },
      });
    }

    await ctx.updateProgress(95);

    // Stage 95 → 100: metadata.txt + debug copies + Render row update.
    const metadataTxt = buildMetadataTxt({
      metadata: input.metadata,
      score: script.score,
      scoreBreakdown: (script.scoreBreakdown as Record<string, number> | null) ?? null,
      reasoning:
        (script.scoreBreakdown as { reasoning?: string } | null)?.reasoning ?? "",
    });
    await fsImpl.writeFile(metadataPath, metadataTxt);

    // Copy debug artifacts. Each is best-effort — missing source files are
    // logged via the warning column rather than failing the whole render.
    const debugCopies: Array<[string, string]> = [
      [input.audioPath, path.join(debugDir, "audio.wav")],
      [render.captionsPath!, path.join(debugDir, "captions.json")],
      [renderInputPath, path.join(debugDir, "render-input.json")],
    ];
    for (const [from, to] of debugCopies) {
      try {
        if (fsImpl.existsSync(from)) {
          await fsImpl.copyFile(from, to);
        }
      } catch {
        // ignore — non-fatal
      }
    }
    // Write a score.json if we have one.
    if (script.score != null) {
      try {
        await fsImpl.writeFile(
          path.join(debugDir, "score.json"),
          JSON.stringify(
            {
              score: script.score,
              breakdown: script.scoreBreakdown,
            },
            null,
            2
          )
        );
      } catch {
        // ignore
      }
    }

    const fileSizeMB = videoStat.size / (1024 * 1024);

    await db.render.update({
      where: { id: render.id },
      data: {
        videoPath: finalVideoPath,
        metadataPath,
        musicPath: mixedMusicPath,
        durationSec: probe.durationSec,
        fileSizeMB,
        status: "done",
        progress: 100,
        error: null,
        completedAt: new Date(),
      },
    });
    emitRender({
      renderId: render.id,
      status: "done",
      progress: 100,
      videoPath: finalVideoPath,
    });

    await db.apiUsage.create({
      data: { service: "remotion", endpoint: "render", traceId: ctx.jobId },
    });

    await ctx.updateProgress(100);

    return {
      renderId: render.id,
      videoPath: finalVideoPath,
      bundleDir,
      durationSec: probe.durationSec,
      fileSizeMB,
    };
  };
}

export const handleRenderScript = createRenderScriptHandler();

// Re-exported for the API layer's 409 mapping.
export { MissingPrerequisiteError };
