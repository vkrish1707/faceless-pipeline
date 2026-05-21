import pLimit from "p-limit";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  searchPhotos as defaultSearchPhotos,
  searchVideos as defaultSearchVideos,
  rankResults,
  cacheKey,
  cachedPexelsSearch as defaultCachedPexelsSearch,
  downloadAsset as defaultDownloadAsset,
  type PexelsPhotoResult,
  type PexelsVideoResult,
  type PexelsMediaType,
} from "@studio/assets";
import { db as defaultDb } from "../../db";
import type { JobHandler } from "../types";

export type FetchBrollPayload = {
  scriptId: string;
  refresh?: boolean;
};

export type FetchBrollResult = {
  beatsProcessed: number;
  beatsSkipped: number;
  candidatesPersisted: number;
  cacheHits: number;
  cacheMisses: number;
  errors?: { beatIndex: number; error: string }[];
};

type VisualBeat = {
  start: number;
  end: number;
  keywords: string[];
  mediaType: PexelsMediaType;
  tone?: string;
  pickedAssetId?: string | null;
};

type Deps = {
  db?: typeof defaultDb;
  searchPhotos?: typeof defaultSearchPhotos;
  searchVideos?: typeof defaultSearchVideos;
  cachedPexelsSearch?: typeof defaultCachedPexelsSearch;
  downloadAsset?: typeof defaultDownloadAsset;
  fetchImpl?: typeof fetch;
  pexelsApiKey?: string;
  cacheDir?: string;
  perPage?: number;
  concurrency?: number;
};

const PER_PAGE = 12;

export function createFetchBrollHandler(deps: Deps = {}): JobHandler<FetchBrollPayload, FetchBrollResult> {
  const db = deps.db ?? defaultDb;
  const searchPhotos = deps.searchPhotos ?? defaultSearchPhotos;
  const searchVideos = deps.searchVideos ?? defaultSearchVideos;
  const cachedPexelsSearchFn = deps.cachedPexelsSearch ?? defaultCachedPexelsSearch;
  const downloadAssetFn = deps.downloadAsset ?? defaultDownloadAsset;
  const perPage = deps.perPage ?? PER_PAGE;
  const concurrency = deps.concurrency ?? 5;

  return async function handleFetchBroll(payload, ctx) {
    const apiKey = deps.pexelsApiKey ?? process.env.PEXELS_API_KEY;
    if (!apiKey) throw new Error("PEXELS_API_KEY not set");

    const cacheDir = deps.cacheDir ?? resolve(workspaceRoot(), "assets/cache");

    // Stage 1: load script and collect beat queries (0 -> 10)
    const script = await db.script.findUniqueOrThrow({ where: { id: payload.scriptId } });
    const beats = (script.visualBeats as unknown as VisualBeat[]) ?? [];

    type QueueItem = { beatIndex: number; beat: VisualBeat; query: string };
    const queue: QueueItem[] = [];
    let skipped = 0;
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i]!;
      const kw = (beat.keywords ?? []).filter((k) => k && k.trim().length > 0);
      if (kw.length === 0) {
        skipped += 1;
        continue;
      }
      queue.push({ beatIndex: i, beat, query: kw.join(" ") });
    }

    if (payload.refresh) {
      for (const q of queue) {
        const k = cacheKey(q.beat.mediaType, q.query, perPage);
        await db.pexelsCache.deleteMany({ where: { queryKey: k } });
      }
    }

    await ctx.updateProgress(10);

    // Stage 2: fetch -> rank -> download (10 -> 80)
    const limit = pLimit(concurrency);
    let hits = 0;
    let misses = 0;
    let processed = 0;
    const errors: { beatIndex: number; error: string }[] = [];

    type BeatAssetData = {
      beatIndex: number;
      query: string;
      mediaType: PexelsMediaType;
      candidates: Array<{
        sourceUrl: string;
        thumbPath: string;
        localPath: string;
        width: number;
        height: number;
        durationSec: number | null;
      }>;
    };
    const collected: BeatAssetData[] = [];
    const total = Math.max(queue.length, 1);

    await Promise.all(
      queue.map((q) =>
        limit(async () => {
          try {
            const k = cacheKey(q.beat.mediaType, q.query, perPage);
            const fetched = await cachedPexelsSearchFn<
              PexelsPhotoResult[] | PexelsVideoResult[]
            >({
              db,
              key: k,
              fetcher: async () => {
                if (q.beat.mediaType === "photo") {
                  return searchPhotos(q.query, { apiKey, perPage, fetchImpl: deps.fetchImpl });
                }
                return searchVideos(q.query, { apiKey, perPage, fetchImpl: deps.fetchImpl });
              },
            });
            if (fetched.hit) hits += 1;
            else misses += 1;

            const ranked =
              q.beat.mediaType === "photo"
                ? rankResults({ items: fetched.data as PexelsPhotoResult[], mediaType: "photo" })
                : rankResults({ items: fetched.data as PexelsVideoResult[], mediaType: "video" });

            const top = ranked.slice(0, 5);
            const downloads = await Promise.all(
              top.map(async (item) => {
                const dl = await downloadAssetFn({
                  url: item.thumb,
                  destDir: cacheDir,
                  fetchImpl: deps.fetchImpl,
                });
                return {
                  sourceUrl: item.full,
                  thumbPath: dl.localPath,
                  localPath: dl.localPath,
                  width: item.width,
                  height: item.height,
                  durationSec:
                    "durationSec" in item ? (item as PexelsVideoResult).durationSec : null,
                };
              })
            );

            collected.push({
              beatIndex: q.beatIndex,
              query: q.query,
              mediaType: q.beat.mediaType,
              candidates: downloads,
            });
          } catch (err) {
            errors.push({
              beatIndex: q.beatIndex,
              error: err instanceof Error ? err.message : String(err),
            });
          } finally {
            processed += 1;
            await ctx.updateProgress(10 + Math.floor((processed / total) * 70));
          }
        })
      )
    );

    await ctx.updateProgress(80);

    // Stage 3: persist Asset rows + ApiUsage (80 -> 100)
    let candidatesPersisted = 0;
    await db.$transaction(async (tx) => {
      // Remove previously fetched (non-manual) candidates for this script.
      await tx.asset.deleteMany({
        where: { scriptId: payload.scriptId, type: { in: ["pexels_photo", "pexels_video"] } },
      });
      for (const bucket of collected) {
        const type = bucket.mediaType === "photo" ? "pexels_photo" : "pexels_video";
        for (const c of bucket.candidates) {
          await tx.asset.create({
            data: {
              scriptId: payload.scriptId,
              beatIndex: bucket.beatIndex,
              type,
              sourceUrl: c.sourceUrl,
              localPath: c.localPath,
              thumbPath: c.thumbPath,
              keyword: bucket.query,
              width: c.width,
              height: c.height,
              durationSec: c.durationSec,
            },
          });
          candidatesPersisted += 1;
        }
      }
      await tx.apiUsage.create({
        data: {
          service: "pexels",
          endpoint: "search",
          traceId: ctx.jobId,
        },
      });
    });

    await ctx.updateProgress(100);

    return {
      beatsProcessed: collected.length,
      beatsSkipped: skipped,
      candidatesPersisted,
      cacheHits: hits,
      cacheMisses: misses,
      ...(errors.length > 0 ? { errors } : {}),
    };
  };
}

function workspaceRoot(): string {
  let dir = process.cwd();
  while (dir !== "/") {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

export const handleFetchBroll = createFetchBrollHandler();
