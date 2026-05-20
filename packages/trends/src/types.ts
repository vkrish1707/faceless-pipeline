export type TrendPoint = {
  date: string;
  value: number;
};

export type RedditPost = {
  title: string;
  ups: number;
  comments: number;
  subreddit: string;
  url: string;
  createdUtc: number;
};

export type GoogleTrendsData = {
  points: TrendPoint[];
  avg: number;
  direction: "rising" | "flat" | "falling";
};

export type RedditTrendsData = {
  posts: RedditPost[];
  topUps: number;
  postCount: number;
};

export type TrendSummaryEntry = {
  googleAvg: number | null;
  googleTrend: "rising" | "flat" | "falling" | null;
  redditTopUps: number | null;
  redditPostCount: number | null;
};

export type TrendSummary = {
  perKeyword: Record<string, TrendSummaryEntry>;
};
