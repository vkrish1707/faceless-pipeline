# Phase 9 — Analytics Feedback Loop

> Implementation phase for the post-distribution layer of [[2026-05-19-faceless-content-pipeline-design]]. Hard dependency: [[2026-05-21-phase-8-distribution]] (must ship first — `Publication` rows are the read-keys for every platform API call here).

## Goal

Close the loop. Pull post-publish performance (views, watch time, retention curves, likes, shares, comments) back from YouTube / TikTok / Instagram into a time-series store, surface per-script analytics in the studio, and feed aggregate signals into Phase 2 scoring so future ideas are evaluated against **what actually worked** instead of what Claude guessed would work.

**Phase 9 is done when:** every published video has its metrics refreshed on a daily tick (and on demand), a `/analytics` dashboard shows top performers + worst flops with retention curves, individual script cards display "after 24h: 3.4k views, 62% AVD", and the Phase 2 scoring prompt receives a `historicalSignals` block whose presence demonstrably shifts scores for new ideas in the same niche.

## Architecture

```
┌─────────────────── apps/studio ──────────────────────────────┐
│  /analytics            — top performers + flops + filters     │
│  /publications/[id]    — per-publication detail (curve + meta)│
│  /scripts (per card)   — "▶ 3.4k · 62% AVD" badge when live   │
│                                                                │
│  POST /api/publications/[id]/metrics/refresh                  │
│  GET  /api/analytics/summary?book=<id>&days=<n>               │
│  GET  /api/analytics/series/[publicationId]?metric=<m>        │
└────────────────────────────────┬──────────────────────────────┘
                                 │
                ┌────────────────┼────────────────┐
                │                │                │
        ┌───────▼────────┐ ┌─────▼─────┐ ┌────────▼────────┐
        │ packages/      │ │ db        │ │ jobs/            │
        │  analytics/    │ │           │ │  fetch-metrics.ts│
        │   youtube      │ │           │ │  daily-tick.ts   │
        │   tiktok       │ │           │ │                  │
        │   instagram    │ │           │ │                  │
        │   normalize    │ │           │ │                  │
        └────────────────┘ └───────────┘ └──────────────────┘
                                 │
                          ┌──────▼──────────┐
                          │ score prompt    │
                          │ now reads       │
                          │ HistoricalSignal│
                          │ aggregates      │
                          └─────────────────┘
```

### Package boundaries

- **`packages/analytics/`** — new package; pure platform clients.
  - `src/youtube.ts` — `fetchVideoStats({ videoId, accessToken, range })` → `{ views, likes, comments, watchTimeSec, avgViewDurationSec, retentionPoints[] }`. Uses YouTube Analytics API v2 (`reports.query`).
  - `src/tiktok.ts` — `fetchVideoStats({ shareId, accessToken })` → `{ views, likes, comments, shares, watchTimeSec }`. Uses TT Research API (or Insights API for the user's own posts).
  - `src/instagram.ts` — `fetchReelInsights({ mediaId, accessToken })` → `{ reach, plays, likes, comments, saves, shares }`. Uses Meta Graph API `insights` endpoint.
  - `src/normalize.ts` — `normalizeMetrics(platform, raw): NormalizedMetric` mapping the per-platform payloads onto a uniform shape (see "Common metric shape" below).
  - `src/retention.ts` — `parseRetentionCurve(platform, raw): { t: number; pct: number }[]` for the curve chart.
- **`apps/studio/lib/jobs/handlers/fetch-metrics.ts`** — DI orchestrator. Per Publication: refresh token (Phase 8 helper) → call platform client → normalize → upsert `PublicationMetric` snapshot. Concurrency `p-limit(getMetricsConcurrency())` (Setting key, default 4).
- **`apps/studio/lib/jobs/handlers/daily-metrics-tick.ts`** — singleton job. Selects all Publications in `published` state whose `lastMetricsAt < now − 24h`, enqueues `fetch_metrics` for each, batches in waves of 50.
- **`apps/studio/lib/analytics/aggregate.ts`** — pure: `aggregateForScoring({ niche, lookbackDays }): HistoricalSignals`. Joins `Publication × PublicationMetric × Script × Idea`. Computes per-feature performance (e.g., "ideas with `targetLengthSec=30` averaged 18% above mean views in this niche over the last 30 days").
- **`packages/pipeline/src/score.ts`** — extends the `SCORING_SYSTEM_PROMPT` with an optional **historical signals** block when the aggregator returns non-empty data. Pure addition; backward-compatible.

## Data model additions

```prisma
model PublicationMetric {
  id            String   @id @default(cuid())
  publicationId String
  publication   Publication @relation(fields: [publicationId], references: [id])

  // Snapshot timestamp — multiple per publication (one per refresh).
  capturedAt    DateTime @default(now())
  // Hours since the publication's publishedAt — denormalized for fast queries.
  hoursSincePub Int

  views         Int      @default(0)
  likes         Int      @default(0)
  comments      Int      @default(0)
  shares        Int      @default(0)        // 0 for YT (no public shares metric); reach for IG
  watchTimeSec  Float?
  avgViewDurationSec Float?                 // YT only; null for TT/IG
  retentionCurve Json?                      // [{ t, pct }] when platform exposes it

  // Per-platform raw payload kept for debugging / future re-normalization.
  raw           Json?

  @@index([publicationId, capturedAt])
  @@index([publicationId, hoursSincePub])
}

// New on Publication (Phase 8 model gains 2 columns).
model Publication {
  // ...existing Phase 8 fields
  lastMetricsAt DateTime?
  // Cached snapshot of the latest metric for fast queries on /analytics
  // and per-card badges — avoids joining PublicationMetric every read.
  latestMetric  Json?     // { views, likes, comments, avgViewDurationSec, capturedAt }
}
```

New `Job.type`: `"fetch_metrics"` and `"daily_metrics_tick"`.

New `Setting` keys (lazy, no schema change):
- `metrics_concurrency` — int string, default `"4"`.
- `metrics_lookback_days` — int string, default `"30"`. The score aggregator's window.
- `enable_historical_scoring` — `"true" | "false"`, default `"false"` until enough data accumulates (auto-flipped to `"true"` after the aggregator returns ≥10 publications in the niche).

### Common metric shape (`packages/analytics/src/normalize.ts`)

```ts
export type NormalizedMetric = {
  views: number;
  likes: number;
  comments: number;
  shares: number;           // 0 when platform doesn't expose
  watchTimeSec: number | null;
  avgViewDurationSec: number | null;
  retentionCurve: { t: number; pct: number }[] | null;
  raw: unknown;             // platform-original
};
```

## User flow

### Daily refresh (background)

- Phase 7's custom server already has the in-process 60s tick used by Phase 8's scheduler. Phase 9 piggy-backs: a separate `dailyTick()` runs every hour, checks if any Publication's `lastMetricsAt` is older than 24h, enqueues `fetch_metrics` for each. Reuses Phase 1 orphan recovery on restart.
- Each `fetch_metrics` job:
  1. Loads Publication → Channel; refreshes OAuth token if needed (Phase 8 helper).
  2. Calls `packages/analytics/<platform>.fetchVideoStats(...)`.
  3. `normalize()` → `PublicationMetric.create(...)`.
  4. Updates `Publication.lastMetricsAt = now()` and `Publication.latestMetric = { views, likes, comments, avgViewDurationSec, capturedAt }`.
  5. Emits `metric.update` on the Phase 7 WS hub so any open `/analytics` page live-updates.

### `/analytics` page

A server-rendered dashboard:
- **Header filters**: book (default: all), niche, lookback days (7/30/90), platform.
- **Top tiles** (lookback-scoped): total publications, total views, median AVD, top platform.
- **Top 10 performers**: table of script title + platform icon + views + AVD bar (sortable).
- **Flops**: bottom 5 (helpful for what NOT to make again).
- **Retention curves panel**: pick 2-3 publications side-by-side to compare retention shapes.
- Each row links to `/publications/<id>` for the detail view.

### `/publications/<id>` (new detail page)

Extends Phase 8's row-only view:
- Metadata header: thumbnail, script title, channel @handle, published-at, externalUrl link.
- **Time-series chart**: views over time (uses all `PublicationMetric` snapshots).
- **Retention curve** (when available).
- **Latest snapshot card**: views / likes / comments / shares / AVD with a refresh button (manual `fetch_metrics` enqueue).

### Per-script badge on `/scripts` page

When a Publication exists in `published` and has `latestMetric != null`, the script card shows a compact chip under the existing render-status badges:

```
▶ 3.4k · 62% AVD · 24h
```

Click the chip → `/publications/<id>`.

### Manual refresh

Buttons on `/publications/<id>` and on each row in `/analytics` enqueue an immediate `fetch_metrics` job for that publication. Returns 202.

### Bulk refresh from `/analytics`

Header action **Refresh all (N due)** enqueues a wave for every publication whose `lastMetricsAt > 6h` ago. Capped at 50 per click to keep API quotas safe.

## Scoring feedback (the loop closer)

### Aggregator (`apps/studio/lib/analytics/aggregate.ts`)

`aggregateForScoring({ niche, lookbackDays = 30 }): HistoricalSignals`

Joins `Publication × Script × Idea` filtered to `Idea.chapter.book.niche === niche` and `Publication.publishedAt > now - lookbackDays`. Reads the **freshest** `PublicationMetric` per publication (the `latestMetric` column makes this cheap).

Output shape:

```ts
type HistoricalSignals = {
  sampleSize: number;             // total publications considered
  median: { views: number; avgViewDurationSec: number };
  byLength: {
    [targetLengthSec: number]: {
      n: number;
      medianViews: number;
      vsBaselinePct: number;      // +18 means 18% above niche median
    };
  };
  byTone: { /* same shape, keyed by visualBeats[].tone modal */ };
  byHookPattern: {                // detected via regex: question, stat, command, story
    [pattern: string]: { n: number; medianViews: number; vsBaselinePct: number };
  };
  topPerformers: {                // 3 short examples for prompt context
    title: string;
    score: number;                // their pre-publish Phase 2 score
    views: number;
    avgViewDurationSec: number;
  }[];
};
```

Pure function, fully unit-testable; no Claude call.

### Score prompt augmentation (`packages/pipeline/src/score.ts`)

Add a third optional system block:

```ts
client.messages.create({
  system: [
    { type: "text", text: SCORING_SYSTEM_PROMPT },
    { type: "text", text: chapterText, cache_control: { type: "ephemeral" } },
    ...(historicalSignals
      ? [{ type: "text", text: historicalSignalsAsPrompt(historicalSignals), cache_control: { type: "ephemeral" } }]
      : []),
  ],
  messages: [{ role: "user", content: scoreUserPrompt(idea, trendSummary) }],
});
```

`historicalSignalsAsPrompt` (pure) emits:

```
HISTORICAL PERFORMANCE (last 30 days, niche=investing, sample=23):
Median: 1,800 views · 18s AVD

By length:
  15s:  n=5, median 3.2k views (+78% vs niche baseline)
  30s:  n=12, median 1.4k views (-22%)
  60s:  n=6, median 2.1k views (+17%)

By dominant tone:
  urgent:    n=8, median 2.6k views (+44%)
  explainer: n=11, median 1.5k views (-17%)
  payoff:    n=4, median 1.9k views (+6%)

By hook pattern:
  stat:    n=10, median 3.0k views (+67%)
  story:   n=7, median 1.6k views (-11%)
  command: n=4, median 1.2k views (-33%)
  question: n=2, median 700 views (-61%)

Top recent performers (pre-publish score → actual views):
  "compound interest beats stock picking"  (score 82 → 4.8k views)
  "the 50/30/20 myth"                       (score 76 → 4.1k views)
  "your 401k is leaking $300/month"         (score 71 → 3.7k views)

Use these signals to anchor your rubric. If an idea matches a top-performer pattern, lean upward; if it matches a known underperformer pattern, lean downward.
```

### Auto-enable gate

The historical block is included only when `Setting("enable_historical_scoring") === "true"`. The job that runs the daily aggregation also auto-flips this Setting from `"false"` to `"true"` once `historicalSignals.sampleSize >= 10` in the active niche. Until then, scoring runs identically to Phase 2.

### Cost / cache awareness

The historical block is small (≤1 KB) and changes daily at most. It uses the same ephemeral-cache control block format Phase 2 established, so multiple idea-score calls in a session share the cache hit.

## Error handling summary

| Failure | Behavior |
|---|---|
| Channel disconnected | `fetch_metrics` job marks PublicationMetric not written, logs warning, continues with next |
| Token refresh fails | Same as Phase 8: surface "reauthorize:<provider>" on the publication detail page |
| Platform returns 429 (quota) | Retry with backoff (1s, 4s); final failure → schedule retry tomorrow's tick |
| Platform returns 0 for a not-yet-indexed video (<10min post-publish) | Snapshot with zeros, no warning; next tick will catch up |
| Publication's externalId is null | Skip silently (it never actually published) |
| Aggregator query exceeds 500ms | Cached value served for 5min (Phase 7 cost-badge pattern); log warning |
| Score prompt size > model limit when historical block added | Drop the block, log warning, score without it |
| HMR / process restart mid-fetch | Phase 1 orphan recovery: failed; daily tick re-enqueues |

## Testing strategy

### Unit

- `packages/analytics/src/youtube.test.ts` — mocked YT Analytics API: happy stats, retention curve parsing, 429 retry, 0-for-fresh-video tolerance.
- `packages/analytics/src/tiktok.test.ts` — mocked TT Insights: stats + parse.
- `packages/analytics/src/instagram.test.ts` — mocked Graph API: insights endpoint shape.
- `packages/analytics/src/normalize.test.ts` — every platform's raw fixture → uniform NormalizedMetric.
- `apps/studio/lib/analytics/aggregate.test.ts` — fixture with 20 Publications + Scripts + Ideas across multiple niches. Asserts:
  - sampleSize counts correctly,
  - vsBaselinePct math sane,
  - groups exclude `n=0` buckets,
  - sortable topPerformers stable.
- `packages/pipeline/src/score.test.ts` — extend: with historicalSignals included, the system array has 3 blocks; without, 2 blocks. Prompt text contains the formatted block.
- `apps/studio/lib/jobs/handlers/fetch-metrics.test.ts` — orchestrator happy path per platform; expired-token refresh path; channel-disconnected → skip + warn.
- `apps/studio/lib/jobs/handlers/daily-metrics-tick.test.ts` — picks only Publications with `lastMetricsAt > 24h`; batches in waves of 50.
- `apps/studio/app/api/analytics/summary/route.test.ts` — query filtering by book/niche/days/platform.

### Integration

- `apps/studio/lib/jobs/handlers/fetch-metrics.integration.test.ts` — WireMock-style stub server impersonating each platform endpoint; runs the orchestrator end-to-end against the real DB.

### Smoke (real platform calls)

- `scripts/smoke/phase9-hello.ts` — calls real YT Analytics API for one fixture videoId from `YOUTUBE_TEST_VIDEO_ID` env, asserts a non-null `views` field comes back. Skips with informative message if env missing. **Not** in `smoke:all` (touches a real Google account).

### Manual UI verification (acceptance)

- Visit `/analytics` → top performer + retention curve renders for at least one Publication.
- Wait 24h or click manual refresh → time-series chart on `/publications/<id>` gains a new datapoint.
- Score a fresh chapter while `enable_historical_scoring` is true → the score job's request body (inspectable via `/admin/logs`) contains the HISTORICAL PERFORMANCE block.
- Disable historical scoring in `/settings` → next score job runs without the block; scores can diverge.

## Out of scope (Phase 10+)

- **Re-train scoring weights from data** — currently we just give Claude richer context. A future phase could solve for the optimal `hook_strength` / `specificity` / etc. weights via gradient descent on real outcomes.
- **A/B testing** — render two variants of a script and split-publish to measure.
- **Cohort analysis** — performance by post-time of day, day of week, follower count at time of post.
- **External benchmark feed** — pull niche averages from external services (e.g., Social Blade) to anchor "outperforming" claims.
- **Predictive scoring** — train a small classifier from historical features → predicted views, run alongside the LLM score.
- **Comment-sentiment-aware re-scoring** — feed top-comment sentiment back into Phase 2.
- **YouTube Audience Retention CSV ingestion** for the deepest retention granularity (the API tops out at decile percentages).

## Acceptance criteria

1. ✅ Daily tick fires within 60s of each hour boundary; picks only Publications whose `lastMetricsAt` is null or >24h old.
2. ✅ `fetch_metrics` job per Publication completes <5s on M3; stores a `PublicationMetric` snapshot and updates `Publication.latestMetric`.
3. ✅ `/analytics` renders top 10 + flops + 2-way retention comparison in <500ms server time on a DB with 100 publications.
4. ✅ `/publications/<id>` shows a time-series chart with at least the snapshots already captured.
5. ✅ Per-script badge on `/scripts` updates within 60s of a manual refresh.
6. ✅ Score job for a niche with ≥10 prior publications includes the `HISTORICAL PERFORMANCE` block in its system prompt. With it disabled, the block is absent.
7. ✅ The aggregator self-enables `enable_historical_scoring` once the threshold is met; never auto-disables.
8. ✅ Manual refresh button on `/publications/<id>` updates the snapshot within 5s.
9. ✅ Killing the WS server doesn't break analytics — manual refresh + page reload still work (polling fallback inherited from Phase 7).
10. ✅ `pnpm test` green; `pnpm smoke:phase9` (with `YOUTUBE_TEST_VIDEO_ID`) exits 0.
11. ✅ All work committed; `phase-9-complete` tag exists.

## Open follow-ups (not blocking Phase 9)

- Retention curve diff overlay (vs. niche median curve).
- Per-script "ideas like this performed N% better" suggestion at extraction time (rather than just at score time).
- A toggle to **rescore** every existing Idea in a book against fresh historical signals.
- Per-channel performance breakdown ("Channel A's median is 3× Channel B's").
- "Why did this flop?" Claude call that explains the gap between predicted score and actual views.
- Export to CSV / Notion for product reviews.
- Public comparison links ("share a top-3 montage").

## Master spec hook

After Phase 9 lands, the loop self-improves:

> Upload PDF → extract → score (informed by **what already worked**) → suggest → script → b-roll → render → publish → metrics ingested → next score run gets better signal → repeat.

The MVP-complete loop becomes a learning loop. Each book published makes the next book's scoring sharper.
