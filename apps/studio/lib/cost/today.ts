/**
 * Pure aggregator for ApiUsage rows → today's + per-book cost summary.
 *
 * Anthropic Claude is the only paid service in the MVP; Pexels is free,
 * Piper and whisper.cpp are local. We keep a unit-cost table for Claude so
 * the badge stays useful even when rows don't include `costUsd`.
 */

export interface AnthropicPriceRow {
  inUsdPerM: number;
  outUsdPerM: number;
  cacheReadUsdPerM: number;
  cacheWriteUsdPerM: number;
}

/** Per-1M-token prices in USD. Updated 2026-05; keep in sync with master spec. */
export const ANTHROPIC_PRICES: Record<string, AnthropicPriceRow> = {
  // Claude 4.7 Sonnet
  "claude-sonnet-4-7": { inUsdPerM: 3, outUsdPerM: 15, cacheReadUsdPerM: 0.3, cacheWriteUsdPerM: 3.75 },
  // Claude 4.7 Haiku
  "claude-haiku-4-7": { inUsdPerM: 1, outUsdPerM: 5, cacheReadUsdPerM: 0.1, cacheWriteUsdPerM: 1.25 },
  // Fallback rate (sonnet)
  default: { inUsdPerM: 3, outUsdPerM: 15, cacheReadUsdPerM: 0.3, cacheWriteUsdPerM: 3.75 },
};

export interface UsageRow {
  service: string;
  endpoint: string;
  tokensIn?: number | null;
  tokensOut?: number | null;
  cacheTokensRead?: number | null;
  cacheTokensCreated?: number | null;
  costUsd?: number | null;
  createdAt: Date | string;
  /**
   * Optional traceId. The summarizer doesn't read it but the API route can
   * pass through a `bookId` filter via the caller's own ApiUsage join.
   */
  traceId?: string | null;
}

export interface CostSummary {
  todayUsd: number;
  bookUsd: number;
  traceCount: number;
}

function priceFor(endpoint: string): AnthropicPriceRow {
  if (endpoint.includes("haiku")) return ANTHROPIC_PRICES["claude-haiku-4-7"]!;
  if (endpoint.includes("sonnet")) return ANTHROPIC_PRICES["claude-sonnet-4-7"]!;
  return ANTHROPIC_PRICES.default!;
}

export function rowCostUsd(row: UsageRow): number {
  // Honour an explicit costUsd when present.
  if (typeof row.costUsd === "number" && Number.isFinite(row.costUsd)) {
    return row.costUsd;
  }
  if (row.service === "anthropic") {
    const p = priceFor(row.endpoint);
    return (
      ((row.tokensIn ?? 0) / 1_000_000) * p.inUsdPerM +
      ((row.tokensOut ?? 0) / 1_000_000) * p.outUsdPerM +
      ((row.cacheTokensRead ?? 0) / 1_000_000) * p.cacheReadUsdPerM +
      ((row.cacheTokensCreated ?? 0) / 1_000_000) * p.cacheWriteUsdPerM
    );
  }
  return 0;
}

function startOfToday(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

export interface SummarizeArgs {
  rows: UsageRow[];
  /**
   * traceIds that belong to the currently-scoped book. When provided, the
   * `bookUsd` total is restricted to rows whose `traceId` is in this set.
   */
  bookTraceIds?: Set<string>;
  /** "now" for deterministic tests. */
  now?: Date;
}

export function summarizeUsage({ rows, bookTraceIds, now }: SummarizeArgs): CostSummary {
  const today = startOfToday(now);
  let todayUsd = 0;
  let bookUsd = 0;
  for (const row of rows) {
    const createdAt = new Date(row.createdAt);
    const cost = rowCostUsd(row);
    if (createdAt >= today) todayUsd += cost;
    if (bookTraceIds && row.traceId && bookTraceIds.has(row.traceId)) {
      bookUsd += cost;
    }
  }
  return {
    todayUsd: round(todayUsd),
    bookUsd: round(bookUsd),
    traceCount: rows.length,
  };
}

function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
