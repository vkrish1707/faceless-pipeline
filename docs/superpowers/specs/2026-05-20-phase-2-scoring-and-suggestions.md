# Phase 2 — Trends, Scoring & Suggestions

> Implementation phase for [[2026-05-19-faceless-content-pipeline-design]] §5.3, §5.4, §5.5, and the Phase 2 milestone in §7. Depends on [[2026-05-20-phase-1-book-to-ideas-design]] (`Job` runner, `Idea` rows, prompt-cache pattern).

## Goal

A chapter that already has 3–8 ideas (Phase 1 output) can be enriched in one click with:
- a 0–100 viral score per idea with a 5-component breakdown,
- a chapter-level suggestion strip (merge / split / drop / series / reframe), each card one-click actionable,
- trend signals (Google Trends + Reddit) cached 24h.

**Phase 2 is done when:** any chapter with ideas can be scored end-to-end via the studio UI; scores arrive in ~30s for a 5-idea chapter; suggestions render as dismissible cards; second run within 24h is a cache hit.

## Architecture

```
┌───────────────── apps/studio ────────────────────┐
│  /books/[id]/chapters/[cid]                       │
│    — idea cards: score badge + sort by score      │
│    — suggestion strip (Accept / Dismiss)          │
│                                                    │
│  POST /api/chapters/[cid]/score      → 1 job      │
│  POST /api/suggestions/[id]/accept                │
│  POST /api/suggestions/[id]/dismiss               │
│  GET  /api/jobs/[id]                              │
└─────────────────────┬─────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
┌───────▼────┐  ┌─────▼────┐  ┌─────▼──────┐
│ trends/    │  │ db       │  │ pipeline/  │
│  google.ts │  │          │  │  score.ts  │
│  reddit.ts │  │          │  │ suggest.ts │
│  keywords  │  │          │  │            │
└────────────┘  └──────────┘  └────────────┘
```

### Package boundaries

- **`packages/trends/`** — pure clients, no DB.
  - `googleTrends(keyword, opts): Promise<TrendPoint[] | null>` where `TrendPoint = { date: string; value: number }`. Uses `google-trends-api`.
  - `redditSearch(keyword, subs, opts): Promise<RedditPost[] | null>` where `RedditPost = { title, ups, comments, subreddit, url, createdUtc }`. Native `fetch` against `reddit.com/r/<sub>/search.json`.
  - `extractKeywords(chapter, ideas, opts?): string[]` — pure helper, deterministic, capped at 12.
- **`packages/pipeline/score.ts`** — pure scoring.
  - `scoreIdea({ idea, chapterText, trendSummary, apiKey, model? }): Promise<{ score, breakdown, reasoning, flags[], usage }>`.
- **`packages/pipeline/suggest.ts`** — pure chapter-level suggestion pass.
  - `suggestForChapter({ chapter, ideas, trendSummary, apiKey, model? }): Promise<{ merges[], splits[], drops[], series[], reframes[], usage }>`.
- **`apps/studio/lib/jobs/score-chapter.ts`** — wraps trends fetch + scoring + suggestions. Persists `TrendSnapshot`, `Idea` updates, `Suggestion` rows, `ApiUsage`. Re-uses the Phase 1 `Job` runner.

## Data model additions

The `Idea` columns `score`, `scoreBreakdown`, `trendSignals`, `flags`, `seriesId` already exist (defined in Phase 0 schema); Phase 2 begins populating them.

New rows added; one new model:

```prisma
model Suggestion {
  id         String   @id @default(cuid())
  chapterId  String
  chapter    Chapter  @relation(fields: [chapterId], references: [id])
  kind       String   // "merge" | "split" | "drop" | "series" | "reframe"
  payload    Json     // shape depends on kind (see §below)
  reason     String
  status     String   // "open" | "accepted" | "dismissed"
  createdAt  DateTime @default(now())
  resolvedAt DateTime?

  @@index([chapterId, status])
}
```

`Suggestion.payload` shape per `kind`:

| kind | payload |
|---|---|
| `merge` | `{ ideaIds: string[]; combinedTitle: string }` |
| `split` | `{ ideaId: string; parts: { title: string; summary: string }[] }` |
| `drop` | `{ ideaId: string }` |
| `series` | `{ ideaIds: string[]; seriesTitle: string }` |
| `reframe` | `{ ideaId: string; altHooks: string[] }` |

New `Job.type` values: `"score_chapter"` (the umbrella job; internally runs trends → score → suggest sequentially).

## User flow

### Trigger (`/books/[id]/chapters/[cid]`)

1. Header gains a **Score & suggest** button. Disabled until the chapter has ≥1 `Idea` row.
2. Click → `POST /api/chapters/[cid]/score`. Server creates `Job(type="score_chapter", targetType="Chapter", targetId=cid)` and returns `{ jobId }` (HTTP 202).
3. UI polls `GET /api/jobs/[id]` every 2s. Stops polling on hidden tab; resumes on focus (reuses Phase 1 polling helper).

### Job stages (single job, observable via `Job.progress`)

```
0   → 10:  fetch trends      (parallel: google + reddit per keyword)
10  → 60:  score each idea   (Claude, p-limit(5))
60  → 95:  suggest chapter   (1 Claude call, all-ideas pass)
95  → 100: persist + commit
```

Each stage writes to `Job.progress` so the UI shows steady movement.

### Idea cards update

- Each `Idea` card now renders a **score badge** (color-coded):
  - ≥ 80 → green
  - 60–79 → amber
  - < 60 → grey
- Hover popover shows the breakdown (hook_strength / specificity / trend_alignment / format_fit / shelf_life) + 1-line reasoning.
- Card grid re-sorts by score desc; ties broken by `orderIndex` ascending.
- If any `Idea.trendSignals.error` is non-null, a tiny "trends partial" indicator appears on the card.

### Suggestion strip

Above the idea grid, a horizontally-scrolling strip shows open `Suggestion` rows. Each card:

- shows the kind (merge / split / drop / series / reframe) as a colored tag,
- shows the affected idea titles,
- shows the reason in 1–2 lines,
- has **Accept** and **Dismiss** buttons.

**Accept actions** are server-side mutations:

| kind | server effect |
|---|---|
| `merge` | Source ideas → `status="dropped"`. New `Idea` row created with `flags.merged_from=[ids]`, `title=combinedTitle`, summary = concatenation of source summaries, `targetLengthSec` = max of sources, status="raw". |
| `split` | Source idea → `status="dropped"`. N new `Idea` rows inserted with the supplied parts. |
| `drop` | Idea → `status="dropped"`. Stays in DB, hidden from UI unless "show dropped" toggle. |
| `series` | All source ideas get `seriesId` = a new cuid; first idea also stores `flags.seriesTitle`. |
| `reframe` | `idea.flags.altHooks` set. No status change. Used in Phase 3 script generation. |

`Suggestion.status` flips to `"accepted"`. The card disappears.

**Dismiss** sets `Suggestion.status="dismissed"` with `resolvedAt=now()`. Never resurfaces.

### Re-score

- Header has **Re-score** (icon button) once a score job has completed.
- Re-running: drops all `Suggestion` rows where `status="open"` for the chapter, then enqueues a fresh `score_chapter` job. Accepted/dismissed suggestions are preserved (audit trail).
- Trend snapshots are NOT invalidated (cache TTL governs that).

## Trend fetching internals

### Keyword extraction (`extractKeywords`)

Deterministic; no LLM call. From the chapter:

1. Tokenize `chapter.rawText` into noun-phrases via a small allowlist heuristic (regex for `(adj?\s+)?(noun)+`). The first ~20 unique noun-phrases.
2. Tokenize every `Idea.title` into noun-phrases.
3. Dedupe (case-insensitive), strip stopwords, cap at **12** keywords. Chapter-title noun-phrases get priority.

Output deterministic order so re-runs hit the same cache keys.

### Google Trends (`packages/trends/src/google.ts`)

- Library: `google-trends-api`. Wrapped, not exposed.
- Call: `interestOverTime({ keyword, geo: "US", timeRange: "now 7-d" })`.
- Parse: extract `default.timelineData[*].value[0]` into `TrendPoint[]`. Normalize 0–100.
- Concurrency: `p-limit(3)`.
- Retries: 2× exponential backoff (1s, 4s) on any thrown error.
- On final failure: log via `pino`, return `null`. Job continues.

### Reddit (`packages/trends/src/reddit.ts`)

- Endpoint: `https://www.reddit.com/r/<sub>/search.json?q=<keyword>&t=week&sort=top&limit=10`.
- Headers: `User-Agent: faceless-pipeline/0.1`. (Reddit blocks default Node UAs.)
- Subreddits (finance niche): `personalfinance`, `investing`, `financialindependence`, `wallstreetbets`, `stocks`, `options`, `Fire`.
- Per (keyword × sub): one request. Concurrency: `p-limit(5)`.
- 429 → exp backoff 2×, then `null`. 5xx → same.
- Parse `data.children[].data` → `{ title, ups, num_comments, subreddit, permalink, created_utc }`.

### Caching (`TrendSnapshot`)

- Lookup key: `(keyword, source)`. Unique constraint already in schema.
- If found AND `fetchedAt > now - 24h` → cache hit, return stored `data`.
- Else fetch, upsert, return.

### Trend summary (used by scoring + suggestions)

After fetch, compute a small JSON summary per chapter:

```json
{
  "perKeyword": {
    "compound interest": {
      "googleAvg": 42,
      "googleTrend": "rising" | "flat" | "falling",
      "redditTopUps": 1240,
      "redditPostCount": 7
    }
  }
}
```

This summary (≤2KB) is what Claude sees, not raw API payloads.

## Scoring internals (`pipeline/score.ts`)

### Call shape

```ts
client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  system: [
    { type: "text", text: SCORING_SYSTEM_PROMPT },
    { type: "text", text: chapterText, cache_control: { type: "ephemeral" } },
  ],
  messages: [{ role: "user", content: scoreUserPrompt(idea, trendSummaryForKeywords(idea)) }],
});
```

Chapter text reuses the same cache control block format Phase 1 established, so multiple idea calls within ~5 min share a single cache.

### Output schema (zod)

```ts
const BreakdownSchema = z.object({
  hook_strength:   z.number().int().min(0).max(25),
  specificity:     z.number().int().min(0).max(20),
  trend_alignment: z.number().int().min(0).max(25),
  format_fit:      z.number().int().min(0).max(15),
  shelf_life:      z.number().int().min(0).max(15),
});

const ScoreSchema = z.object({
  score:      z.number().int().min(0).max(100),
  breakdown:  BreakdownSchema,
  reasoning:  z.string().min(10).max(400),
  flags:      z.array(z.string()).max(5),
});
```

Validator additionally checks `|score - sum(breakdown)| ≤ 1` (rounding tolerance). On violation: retry once with the error appended to the prompt; if still wrong, fail the row.

### Persistence

`Idea.score`, `Idea.scoreBreakdown`, `Idea.flags`, `Idea.trendSignals` (the per-idea trend summary subset) are updated in one transaction.

## Suggestion internals (`pipeline/suggest.ts`)

- One Claude call per chapter, after all ideas scored.
- System (cached): suggestion rubric + chapter rawText + serialized list of ideas (id, title, summary, score, breakdown).
- User: "Propose merges/splits/drops/series/reframes. Be conservative — only suggest if confidence is high."
- Output schema mirrors master spec §5.5; validated with zod. Empty arrays are allowed.
- Each non-empty item becomes a `Suggestion` row.

## Error handling summary

| Failure | Behavior |
|---|---|
| Google Trends throws (rate limit, network) | `null` data for that keyword; logged; scoring continues |
| Reddit 429 / 5xx | 2 retries; final `null`; logged |
| Claude 429 / 5xx (score) | Job-level 2x retry on the specific idea; fail-row if persistent |
| Claude schema fail (score) | 1 self-correcting retry, then fail-row |
| Sum-check fails (`score ≠ Σbreakdown`) | Same as schema fail |
| Chapter has zero ideas | 400 from `/api/chapters/[cid]/score`; UI greys out button |
| HMR / process restart with running scoring job | Reuse Phase 1 orphan recovery: status→`failed`, error="interrupted" |
| Accept conflicts (idea already dropped by prior accept) | 409, UI refreshes the strip from server |

## Testing strategy

### Unit

- `packages/trends/src/google.test.ts` — mocked library; happy + 2-retry + final-null.
- `packages/trends/src/reddit.test.ts` — mocked fetch; happy + 429 retry + parse.
- `packages/trends/src/keywords.test.ts` — `extractKeywords` deterministic order, dedupe, cap.
- `packages/pipeline/src/score.test.ts` — mocked Anthropic; happy + 429 retry + schema fail + sum-check fail.
- `packages/pipeline/src/suggest.test.ts` — mocked Anthropic; happy + empty-arrays + partial parse.
- `apps/studio/lib/jobs/score-chapter.test.ts` — orchestration; verifies progress monotonicity and TrendSnapshot upsert path.

### Integration

- `apps/studio/lib/jobs/score-chapter.integration.test.ts` — runs the whole flow against a fixture chapter + 3 ideas, mocked Anthropic and mocked HTTP for trends. Asserts `Idea.score` populated and ≥1 `Suggestion` row created.

### Smoke

- `scripts/smoke/phase2-hello.ts` — **real** Claude + **real** Reddit on a tiny fixture chapter (~500 words, 2 ideas). Skips Google Trends if `SKIP_TRENDS=1` (the library is flaky in CI). Costs ~1¢ per run. Registered as `pnpm smoke:phase2`. Not in `smoke:all`.

### Manual UI verification (acceptance)

- Open a chapter from Phase 1, click **Score & suggest**, watch progress, see badges + strip within 30s on M3.

## Out of scope (Phase 3+)

- Re-scoring scripts (lives in Phase 3 after script text exists).
- YouTube Data API as a third trend source.
- Per-niche subreddit configuration (hardcoded to finance subs for now).
- Bulk accept/dismiss UI.
- Trend chart visualization on hover (we just show numbers).
- Cross-chapter suggestion (e.g., "this idea belongs in Chapter 4").

## Acceptance criteria

1. ✅ Clicking **Score & suggest** on a 5-idea chapter completes in ≤30s on M3.
2. ✅ Every idea has a numeric `score`, populated `scoreBreakdown`, and a color-coded badge.
3. ✅ Idea grid is sorted by score desc; ties stable on `orderIndex`.
4. ✅ At least one `Suggestion` row appears on the test chapter; Accept on a `drop` makes the idea card vanish; Dismiss removes the card without mutating ideas.
5. ✅ Re-running within 24h logs zero new `TrendSnapshot` inserts (cache hit) but still recomputes scores.
6. ✅ Reddit-only outage (network mock returning 503) still produces scores; idea cards show a "trends partial" indicator.
7. ✅ `pnpm test` green; `pnpm smoke:phase2` exits 0.
8. ✅ All work committed; `phase-2-complete` tag exists.

## Open follow-ups (not blocking Phase 2)

- Bulk-accept controls on the suggestion strip (Accept all merges).
- Trend snapshot inspector at `/admin/trends`.
- Surface "merged_from" lineage on merged-idea cards.
- Auto-trigger `Score & suggest` when ideas finish extracting (currently manual).
