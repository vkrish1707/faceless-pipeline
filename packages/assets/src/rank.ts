import type { PexelsPhotoResult, PexelsVideoResult } from "./pexels";

const TARGET_AR = 9 / 16;
const MAX_VIDEO_SEC = 30;
const MIN_VIDEO_HEIGHT = 1080;
const TOP_N = 5;

type RankPhotoOpts = { items: PexelsPhotoResult[]; mediaType: "photo" };
type RankVideoOpts = { items: PexelsVideoResult[]; mediaType: "video" };

export function rankResults(opts: RankPhotoOpts): PexelsPhotoResult[];
export function rankResults(opts: RankVideoOpts): PexelsVideoResult[];
export function rankResults(
  opts: RankPhotoOpts | RankVideoOpts
): PexelsPhotoResult[] | PexelsVideoResult[] {
  if (opts.mediaType === "photo") {
    return [...opts.items]
      .map((p) => ({ ...p, _ar: aspectRatioDelta(p.width, p.height) }))
      .sort(compareByArThenId)
      .slice(0, TOP_N)
      .map(stripAr);
  }
  return [...opts.items]
    .filter((v) => v.durationSec <= MAX_VIDEO_SEC && v.height >= MIN_VIDEO_HEIGHT)
    .map((v) => ({ ...v, _ar: aspectRatioDelta(v.width, v.height) }))
    .sort(compareByArThenId)
    .slice(0, TOP_N)
    .map(stripAr);
}

function aspectRatioDelta(width: number, height: number): number {
  if (!width || !height) return Number.POSITIVE_INFINITY;
  return Math.abs(width / height - TARGET_AR);
}

function compareByArThenId(a: { _ar: number; id: number }, b: { _ar: number; id: number }): number {
  if (a._ar !== b._ar) return a._ar - b._ar;
  return a.id - b.id;
}

function stripAr<T extends { _ar: number }>(o: T): Omit<T, "_ar"> {
  const { _ar: _ar, ...rest } = o;
  return rest;
}
