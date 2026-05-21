import { promises as fsPromises } from "node:fs";
import path from "node:path";
import { db as defaultDb } from "../db";
import type {
  RenderInput,
  Beat as RemotionBeat,
  ChartSpec,
  Theme,
  CaptionWord,
} from "@remotion-pkg/data/types";

/**
 * `buildRenderInput` collects every input the Remotion composition needs and
 * shapes it into the `RenderInput` JSON contract. The result is what the job
 * handler writes to `output/<scriptId>/render-input.json` and passes to the
 * Remotion CLI via `--props=<json>`.
 *
 * This module is intentionally pure (DB + fs reads only — no spawn, no
 * network) so it can be tested end-to-end with the in-memory SQLite database
 * and a temp-dir captions file.
 */

export class MissingPrerequisiteError extends Error {
  /** Short token identifying what's missing — "audio", "captions", "pickedAsset:<beatIdx>". */
  missing: string;
  constructor(missing: string, detail: string) {
    super(`render prerequisite missing: ${missing} (${detail})`);
    this.name = "MissingPrerequisiteError";
    this.missing = missing;
  }
}

type StoredBeat = {
  start: number;
  end: number;
  keywords?: string[];
  mediaType?: "photo" | "video";
  tone?: RemotionBeat["tone"];
  chart?: ChartSpec | null;
  pickedAssetId?: string | null;
};

type StoredMetadata = {
  youtubeTitle?: string;
  caption?: string;
  hashtags?: string[];
  thumbnailConcept?: string;
};

export type BuildRenderInputOpts = {
  db?: typeof defaultDb;
  scriptId: string;
  theme?: Theme;
  /** Inject a captions JSON reader (defaults to fs.readFile + JSON.parse). */
  readCaptions?: (captionsPath: string) => Promise<{ words: CaptionWord[] }>;
};

const FPS = 30 as const;

async function defaultReadCaptions(captionsPath: string): Promise<{ words: CaptionWord[] }> {
  const raw = await fsPromises.readFile(captionsPath, "utf8");
  const parsed = JSON.parse(raw) as { words?: CaptionWord[] };
  return { words: parsed.words ?? [] };
}

export async function buildRenderInput(opts: BuildRenderInputOpts): Promise<RenderInput> {
  const db = opts.db ?? defaultDb;
  const theme: Theme = opts.theme ?? "finance-dark";
  const readCaptions = opts.readCaptions ?? defaultReadCaptions;

  const script = await db.script.findUniqueOrThrow({
    where: { id: opts.scriptId },
    include: { render: true },
  });

  const render = script.render;
  if (!render || !render.audioPath) {
    throw new MissingPrerequisiteError("audio", "Render.audioPath is null — synthesize the script first");
  }
  if (!render.captionsPath) {
    throw new MissingPrerequisiteError("captions", "Render.captionsPath is null — synthesize the script first");
  }

  const beats: StoredBeat[] = (script.visualBeats as unknown as StoredBeat[]) ?? [];
  if (beats.length === 0) {
    throw new MissingPrerequisiteError("visualBeats", "script has no beats");
  }

  // Collect picked asset ids and load the rows in a single query.
  const pickedIds: string[] = [];
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i]!;
    if (!beat.pickedAssetId) {
      throw new MissingPrerequisiteError(
        `pickedAsset:${i}`,
        `beat ${i} (${beat.start}-${beat.end}s) has no pickedAssetId`
      );
    }
    pickedIds.push(beat.pickedAssetId);
  }

  const assets = await db.asset.findMany({
    where: { id: { in: pickedIds } },
  });
  const assetById = new Map(assets.map((a) => [a.id, a] as const));

  // Build the beat list in order, resolving to absolute paths.
  const visualBeats: RemotionBeat[] = beats.map((beat, i) => {
    const asset = assetById.get(beat.pickedAssetId!);
    if (!asset) {
      throw new MissingPrerequisiteError(
        `pickedAsset:${i}`,
        `beat ${i} references missing Asset id ${beat.pickedAssetId}`
      );
    }
    const assetType: "photo" | "video" =
      asset.type === "pexels_video" || asset.type === "manual_video"
        ? "video"
        : beat.mediaType === "video"
          ? "video"
          : "photo";
    const out: RemotionBeat = {
      start: beat.start,
      end: beat.end,
      tone: beat.tone ?? "explainer",
      assetPath: path.resolve(asset.localPath),
      assetType,
    };
    if (beat.chart) out.chart = beat.chart;
    return out;
  });

  // Captions: read from disk for lastWordEnd + word timings.
  const captions = await readCaptions(render.captionsPath);

  const lastWordEnd =
    captions.words.length > 0
      ? captions.words.at(-1)!.end
      : 0;
  const lastBeatEnd = beats.at(-1)!.end;
  const audioDur = render.durationSec ?? 0;

  // durationFrames = round(lastWordEnd * 30), clamped up to max(audio, lastBeat) * 30.
  const baseFrames = Math.round(lastWordEnd * FPS);
  const clampUpper = Math.max(audioDur, lastBeatEnd, lastWordEnd) * FPS;
  const durationFrames = Math.max(1, Math.min(Math.max(baseFrames, Math.ceil(clampUpper)), Math.ceil(clampUpper)));

  const metadata = ((script.metadata as unknown) as StoredMetadata) ?? {};

  return {
    scriptId: script.id,
    durationFrames,
    fps: FPS,
    width: 1080,
    height: 1920,
    audioPath: path.resolve(render.audioPath),
    captions,
    visualBeats,
    theme,
    metadata: {
      youtubeTitle: metadata.youtubeTitle ?? "",
      caption: metadata.caption ?? "",
      hashtags: metadata.hashtags ?? [],
      thumbnailConcept: metadata.thumbnailConcept ?? "",
    },
    hookText: script.hook,
    ctaText: script.cta,
  };
}
