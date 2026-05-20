import type { GoogleTrendsData, RedditTrendsData, TrendSummary, TrendSummaryEntry } from "./types";

export type PerKeywordResult = {
  keyword: string;
  google: GoogleTrendsData | null;
  reddit: RedditTrendsData | null;
};

export function buildTrendSummary(results: PerKeywordResult[]): TrendSummary {
  const perKeyword: Record<string, TrendSummaryEntry> = {};
  for (const r of results) {
    perKeyword[r.keyword] = {
      googleAvg: r.google ? r.google.avg : null,
      googleTrend: r.google ? r.google.direction : null,
      redditTopUps: r.reddit ? r.reddit.topUps : null,
      redditPostCount: r.reddit ? r.reddit.postCount : null,
    };
  }
  return { perKeyword };
}
