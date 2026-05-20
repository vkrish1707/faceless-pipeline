declare module "google-trends-api" {
  type Opts = {
    keyword: string | string[];
    startTime?: Date;
    endTime?: Date;
    geo?: string;
    hl?: string;
    timezone?: number;
    category?: number;
    property?: string;
    granularTimeResolution?: boolean;
  };
  const api: {
    interestOverTime(opts: Opts): Promise<string>;
    relatedQueries(opts: Opts): Promise<string>;
    relatedTopics(opts: Opts): Promise<string>;
    dailyTrends(opts: { trendDate?: Date; geo?: string; hl?: string }): Promise<string>;
  };
  export default api;
}
