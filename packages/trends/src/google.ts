import googleTrendsApi from "google-trends-api";
import type { GoogleTrendsData, TrendPoint } from "./types";

export type GoogleTrendsOpts = {
  keyword: string;
  geo?: string;
  timeRangeDays?: number;
  maxAttempts?: number;
  logger?: { warn: (msg: string, meta?: unknown) => void };
};

type LibraryResult = string;

type RawPoint = {
  time?: string;
  formattedAxisTime?: string;
  value?: number[];
};

type RawShape = {
  default?: {
    timelineData?: RawPoint[];
  };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function googleTrends(opts: GoogleTrendsOpts): Promise<GoogleTrendsData | null> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const days = opts.timeRangeDays ?? 7;
  const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const raw: LibraryResult = await googleTrendsApi.interestOverTime({
        keyword: opts.keyword,
        geo: opts.geo ?? "US",
        startTime,
      });
      return parse(raw);
    } catch (err) {
      if (attempt >= maxAttempts) {
        opts.logger?.warn?.(`googleTrends failed for "${opts.keyword}" after ${attempt} attempts`, err);
        return null;
      }
      await sleep(attempt === 1 ? 1000 : 4000);
    }
  }
  return null;
}

function parse(raw: string): GoogleTrendsData | null {
  let parsed: RawShape;
  try {
    parsed = JSON.parse(raw) as RawShape;
  } catch {
    return null;
  }
  const timeline = parsed.default?.timelineData ?? [];
  const points: TrendPoint[] = [];
  for (const entry of timeline) {
    const value = entry.value?.[0];
    const date = entry.formattedAxisTime ?? entry.time;
    if (typeof value === "number" && typeof date === "string") {
      points.push({ date, value: Math.max(0, Math.min(100, value)) });
    }
  }
  if (points.length === 0) return null;
  const avg = Math.round(points.reduce((s, p) => s + p.value, 0) / points.length);
  return { points, avg, direction: classifyDirection(points) };
}

function classifyDirection(points: TrendPoint[]): "rising" | "flat" | "falling" {
  if (points.length < 4) return "flat";
  const half = Math.floor(points.length / 2);
  const firstHalf = points.slice(0, half);
  const secondHalf = points.slice(-half);
  const a = firstHalf.reduce((s, p) => s + p.value, 0) / firstHalf.length;
  const b = secondHalf.reduce((s, p) => s + p.value, 0) / secondHalf.length;
  const delta = b - a;
  if (delta >= 5) return "rising";
  if (delta <= -5) return "falling";
  return "flat";
}
