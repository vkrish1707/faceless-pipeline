import type { RedditPost, RedditTrendsData } from "./types";

export const FINANCE_SUBREDDITS = [
  "personalfinance",
  "investing",
  "financialindependence",
  "wallstreetbets",
  "stocks",
  "options",
  "Fire",
] as const;

export type RedditSearchOpts = {
  keyword: string;
  subreddits?: readonly string[];
  limit?: number;
  maxAttempts?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  logger?: { warn: (msg: string, meta?: unknown) => void };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type RawChild = {
  data?: {
    title?: string;
    ups?: number;
    num_comments?: number;
    subreddit?: string;
    permalink?: string;
    created_utc?: number;
  };
};

type RawListing = {
  data?: { children?: RawChild[] };
};

export async function redditSearch(opts: RedditSearchOpts): Promise<RedditTrendsData | null> {
  const subs = opts.subreddits ?? FINANCE_SUBREDDITS;
  const limit = opts.limit ?? 10;
  const ua = opts.userAgent ?? "faceless-pipeline/0.1";
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxAttempts = opts.maxAttempts ?? 3;

  const all: RedditPost[] = [];
  let anySuccess = false;
  for (const sub of subs) {
    const posts = await fetchSub(sub, opts.keyword, limit, ua, maxAttempts, fetchImpl, opts.logger);
    if (posts !== null) {
      anySuccess = true;
      all.push(...posts);
    }
  }

  if (!anySuccess) return null;

  const topUps = all.reduce((m, p) => Math.max(m, p.ups), 0);
  return { posts: all, topUps, postCount: all.length };
}

async function fetchSub(
  sub: string,
  keyword: string,
  limit: number,
  ua: string,
  maxAttempts: number,
  fetchImpl: typeof fetch,
  logger?: { warn: (msg: string, meta?: unknown) => void }
): Promise<RedditPost[] | null> {
  const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/search.json?q=${encodeURIComponent(
    keyword
  )}&t=week&sort=top&limit=${limit}&restrict_sr=1`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchImpl(url, { headers: { "User-Agent": ua } });
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        if (attempt >= maxAttempts) {
          logger?.warn?.(`reddit ${res.status} for r/${sub} "${keyword}" after ${attempt} attempts`);
          return null;
        }
        await sleep(attempt === 1 ? 2000 : 4000);
        continue;
      }
      if (!res.ok) {
        logger?.warn?.(`reddit ${res.status} for r/${sub} "${keyword}" (non-retryable)`);
        return null;
      }
      const json = (await res.json()) as RawListing;
      return parse(json);
    } catch (err) {
      if (attempt >= maxAttempts) {
        logger?.warn?.(`reddit fetch threw for r/${sub} "${keyword}"`, err);
        return null;
      }
      await sleep(attempt === 1 ? 2000 : 4000);
    }
  }
  return null;
}

function parse(json: RawListing): RedditPost[] {
  const children = json.data?.children ?? [];
  const out: RedditPost[] = [];
  for (const c of children) {
    const d = c.data;
    if (!d) continue;
    if (typeof d.title !== "string") continue;
    out.push({
      title: d.title,
      ups: typeof d.ups === "number" ? d.ups : 0,
      comments: typeof d.num_comments === "number" ? d.num_comments : 0,
      subreddit: typeof d.subreddit === "string" ? d.subreddit : "",
      url: typeof d.permalink === "string" ? `https://www.reddit.com${d.permalink}` : "",
      createdUtc: typeof d.created_utc === "number" ? d.created_utc : 0,
    });
  }
  return out;
}
