# Phase 3 — Script Generation, Review & Metadata

> Implementation phase for [[2026-05-19-faceless-content-pipeline-design]] §5.6, §5.7, and the Phase 3 milestone in §7. Depends on [[2026-05-20-phase-1-book-to-ideas-design]] (Job runner, prompt-cache pattern) and [[2026-05-20-phase-2-scoring-and-suggestions]] (scored, suggestion-curated ideas).

## Goal

For a set of approved ideas in a chapter, generate full scripts (hook / body / CTA / visualBeats / metadata) via Claude in parallel, present them in an editable review screen, and re-score after edits.

**Phase 3 is done when:** a user selects N scored ideas → clicks "Generate scripts" → N script cards render within ~60s for N=5, each with editable hook/body/CTA, beat list (read-only preview), and a copy-ready metadata block.

## Architecture

```
┌──────────────────── apps/studio ──────────────────────┐
│  /books/[id]/chapters/[cid]                            │
│    — idea cards now have Approve toggle                │
│    — header: "Generate scripts (N selected)"           │
│                                                        │
│  /books/[id]/chapters/[cid]/scripts                    │
│    — script cards grid (editable)                      │
│                                                        │
│  POST  /api/chapters/[cid]/approve                     │
│  POST  /api/chapters/[cid]/generate-scripts            │
│  GET   /api/scripts/[id]                               │
│  PATCH /api/scripts/[id]            (inline edit save) │
│  POST  /api/scripts/[id]/rescore                       │
└─────────────────────────┬──────────────────────────────┘
                          │
                ┌─────────┼──────────┐
                │         │          │
        ┌───────▼─┐  ┌────▼───┐ ┌────▼────────┐
        │ db      │  │ pipeline│ │ jobs/       │
        │         │  │ script.ts│ │ generate-   │
        │         │  │ rescore.ts││ script.ts   │
        └─────────┘  └─────────┘ └─────────────┘
```

### Package boundaries

- **`packages/pipeline/script.ts`** — pure script generation.
  - `generateScript({ idea, chapterText, niche, apiKey, model? }): Promise<{ script: ScriptOutput; usage }>`. Does not touch DB.
- **`packages/pipeline/rescore.ts`** — pure re-score of a polished script.
  - `rescoreScript({ script, chapterText, trendSummary, apiKey, model? }): Promise<{ score, breakdown, reasoning, usage }>`.
- **`apps/studio/lib/jobs/generate-script.ts`** — wraps one Claude call, persists `Script` row, links to `Idea`, transitions `Idea.status="scripted"`.
- **`apps/studio/lib/jobs/rescore-script.ts`** — re-runs scoring against the edited text. Writes `Script.score`.

## Data model changes

The `Script` model already exists from Phase 0 (`hook`, `body`, `cta`, `visualBeats: Json`, `metadata: Json`, `score: Int?`, `status`). Phase 3 populates it.

Additive columns:

```prisma
model Script {
  // ...existing fields
  approvedAt        DateTime?
  lastEditedAt      DateTime?
  generatedAt       DateTime?  // first save from Claude
  warnings          Json?      // [{ kind: "word_budget" | "beat_coverage", detail: string }]
}
```

No new tables.

`Idea.status` transitions managed in Phase 3:
- `scored` → `approved` (when user toggles Approve)
- `approved` → `scripted` (when generate_script job succeeds)
- `approved` → `scored` (when user un-approves before generation)

New `Job.type` values: `"generate_script"`, `"rescore_script"`.

## User flow

### Approval (`/books/[id]/chapters/[cid]`)

1. Each idea card gains a checkbox or "Approve" pill. State persists optimistically.
2. Toggling fires `POST /api/chapters/[cid]/approve` with `{ ideaIds: string[] }`. Server sets each idea's `status="approved"` (or rolls back to `"scored"` for removed ids) in a single transaction.
3. Chapter header shows count: **Generate scripts (N selected)**. Disabled if N=0 or a generate job is already running for this chapter.

### Generation (fire-and-forget per script)

1. Click **Generate scripts** → `POST /api/chapters/[cid]/generate-scripts`. Server:
   - Creates one `Job(type="generate_script", targetType="Idea", targetId=<ideaId>)` per approved idea, all sharing a generated `jobGroupId` (stored in `Job.payload.groupId`).
   - Returns `{ jobIds: string[], groupId }` (HTTP 202).
   - Invokes `runJob` for each job with internal `p-limit(5)` on `generate_script` jobs across the app.
2. Client redirects to `/books/[id]/chapters/[cid]/scripts?group=<groupId>`.
3. Page loads existing scripts for the chapter (if any) and polls every 2s for the group's jobs.
4. Each script card cycles `queued → running (progress=30) → running (progress=85) → completed (100)`. On completion, the card hydrates with hook/body/CTA/metadata.

### Script review (`/books/[id]/chapters/[cid]/scripts`)

Grid of cards. Each card:

- **Header:** idea title, target length pill, score badge (from Phase 2; updates after rescore).
- **Hook** — single-line editable text. Character counter (warns >180 chars).
- **Body** — multi-line editable textarea (autosize). Word counter visible.
- **CTA** — single-line editable.
- **Beats** — read-only summary list: `{ start–end }s · {keywords joined} · {tone} · {mediaType}`. Plus a "✨ chart" badge when `chart` is set. Picker comes in Phase 5.
- **Metadata** (collapsible accordion):
  - YouTube title (≤60 char, editable)
  - Caption (editable)
  - Hashtags (chip input)
  - Thumbnail concept (textarea)
  - Per-section copy-to-clipboard buttons.
- **Warnings**: small chips below body if `Script.warnings` has entries (word budget exceeded, beat coverage off).
- **Actions row:** Re-score · Regenerate · Delete · Open in new tab.

### Inline editing

- Hook / body / CTA / metadata fields are saved on **blur** (debounce 800 ms after last keystroke).
- `PATCH /api/scripts/[id]` accepts a partial update body; server validates lengths, writes, sets `lastEditedAt=now()`.
- A change to **hook** or **body** with Levenshtein distance ≥ 5% of the original length triggers an automatic `rescore_script` job. UI shows "score updating…" until done. CTA/metadata edits do NOT auto-rescore.
- Manual **Re-score** button always enqueues a fresh `rescore_script` job.

### Regenerate

Per-card **Regenerate** button:
- Confirm modal ("This replaces the current script. Edits will be lost.").
- Enqueues a fresh `generate_script` job for that idea, which overwrites the existing `Script` row. Idempotent — Phase 1's "every stage overwrites" rule applies.

## Script generation internals

### Call shape

```ts
client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 2048,
  system: [
    { type: "text", text: SCRIPT_SYSTEM_PROMPT },
    { type: "text", text: chapterText, cache_control: { type: "ephemeral" } },
    { type: "text", text: NICHE_STYLE_GUIDE[niche], cache_control: { type: "ephemeral" } },
  ],
  messages: [{ role: "user", content: scriptUserPrompt(idea) }],
});
```

The chapter text cache block reuses what Phase 1/2 already populated within the 5-min TTL — so within a single user session, generating scripts for the same chapter incurs cache reads, not creates.

### `scriptUserPrompt`

Embeds: idea.title, idea.summary, idea.targetLengthSec, idea.sourceQuotes, idea.candidateHooks (or `Idea.flags.altHooks` if it was reframed in Phase 2), idea.score breakdown (so Claude knows what to lean into).

Asks for:
- `hook` 3-second pattern-interrupt
- `body` ~`2.5 × targetLengthSec` words
- `cta` final 2 seconds
- `visualBeats[]` covering the script timeline edge-to-edge
- `metadata` with platform-ready fields

### Output schema (zod)

```ts
const ChartSpecSchema = z.object({
  kind:      z.enum(["stat", "bar", "line"]),
  label:     z.string().min(1).max(80),
  data:      z.array(z.number()).max(8).optional(),
  bigNumber: z.string().max(20).optional(),
});

const BeatSchema = z.object({
  start:      z.number().min(0),
  end:        z.number().min(0),
  keywords:   z.array(z.string().min(1)).min(1).max(5),
  mediaType:  z.enum(["photo", "video"]),
  tone:       z.enum(["urgent", "explainer", "payoff"]),
  chart:      ChartSpecSchema.optional(),
}).refine(b => b.end > b.start, { message: "beat end must be > start" });

const MetadataSchema = z.object({
  youtubeTitle:     z.string().min(5).max(60),
  caption:          z.string().min(10).max(280),
  hashtags:         z.array(z.string().regex(/^#[a-zA-Z0-9_]+$/)).min(1).max(8),
  thumbnailConcept: z.string().min(10).max(200),
});

const ScriptSchema = z.object({
  hook:        z.string().min(5).max(180),
  body:        z.string().min(50).max(800),
  cta:         z.string().min(5).max(120),
  visualBeats: z.array(BeatSchema).min(2),
  metadata:    MetadataSchema,
});
```

### Soft validation (warnings, not failures)

- **Word budget:** `wc(hook + body + cta)` should be within `±10%` of `2.5 × targetLengthSec`. Violation → push to `Script.warnings`, do not fail.
- **Beat coverage:** `Σ (beat.end − beat.start)` should equal `targetLengthSec ± 1s`. Violation → warning. Also: consecutive beats should not overlap (hard check; if they do, reject and retry once).
- **Hashtag dedupe:** lowercase the set; dedupe before persisting.

Soft warnings let the user iterate without re-generating from scratch — they can edit body length manually and the warning clears on next save.

## Re-score internals

`rescoreScript` reuses the Phase 2 `scoreIdea` rubric but the "idea" sent to Claude is constructed from the polished script:

- `title` ← `Script.idea.title` (unchanged)
- `summary` ← `Script.hook + " " + Script.body.slice(0, 240)`
- everything else unchanged

Writes `Script.score`. Idea-level `Idea.score` is left untouched (it represents the raw idea quality; script score represents polish).

## Concurrency

- App-wide `p-limit(5)` for `generate_script` jobs (master spec §3).
- A chapter can have multiple concurrent generations but the same idea cannot have two in-flight: enforced by checking `Job` for an existing running job on that ideaId before enqueueing.

## Error handling summary

| Failure | Behavior |
|---|---|
| Claude 429 / 5xx | 2× exponential retry (1s, 4s) inside the job |
| Claude schema fail | 1 self-correcting retry with parse error appended; then mark job failed |
| Beat overlap | 1 self-correcting retry; then fail |
| Word-budget violation | Warning persisted; job succeeds |
| Beat-coverage violation | Warning persisted; job succeeds |
| Idea status race (un-approved while running) | Job completes anyway; user sees the script; status flips back to `scripted` |
| Inline edit hits length cap | 400 from PATCH; UI shows inline error, does not save |
| HMR / process restart with in-flight gen | Reuse Phase 1 orphan recovery: `failed`, error="interrupted" |

## Testing strategy

### Unit (TDD red → green)

- `packages/pipeline/src/script.test.ts` — mocked Anthropic:
  - happy path returns parsed script + usage,
  - 429 retried then succeeded,
  - schema-fail throws after retries,
  - beat-overlap triggers self-correcting retry.
- `packages/pipeline/src/rescore.test.ts` — mocked Anthropic happy + schema-fail.
- `apps/studio/lib/scripts/validators.test.ts` —
  - word-budget classifier returns `{ overBy: number, withinTolerance: boolean }`,
  - beat-coverage classifier same shape,
  - hashtag dedupe lowercases + removes dups.
- `apps/studio/lib/scripts/diff.test.ts` —
  - Levenshtein ≥5% triggers `shouldRescore: true`,
  - whitespace-only edits return `false`.
- `apps/studio/lib/jobs/generate-script.test.ts` — happy path persists Script + transitions Idea.status; failure path writes Job.error.

### Integration

- `apps/studio/lib/jobs/generate-script.integration.test.ts` — runs against fixture idea, mocked Anthropic; verifies `Script` row, beats persisted as JSON, idea transitioned.

### Smoke

- `scripts/smoke/phase3-hello.ts` — **real** Claude on a tiny fixture idea; asserts the response validates against `ScriptSchema`. Registered as `pnpm smoke:phase3`. Costs ~2¢ per run. Not in `smoke:all`.

### Manual UI verification (acceptance)

- Approve 5 ideas → click Generate → 5 cards populate within 60s on M3 → edit a hook → score updates within ~10s → copy hashtags → metadata appears on clipboard.

## Out of scope (Phase 4+)

- Voice synthesis (Phase 4).
- B-roll picker (Phase 5).
- Remotion render (Phase 6).
- Multi-language scripts.
- Series-aware generation (Part-1 / Part-2 cross-referencing using `seriesId`).
- Generate-with-variants (3 alternative hooks in one call).
- Style-preset picker on the chapter level.

## Acceptance criteria

1. ✅ Approve 5 ideas → 5 scripts ready in <60s on M3.
2. ✅ Each script validates against `ScriptSchema`; `visualBeats.length ≥ 2`.
3. ✅ Edit a hook (>5% change) → auto-rescore fires, score updates within 10s.
4. ✅ Copy buttons place youtubeTitle / caption / hashtags on clipboard.
5. ✅ Reload preserves all edits (`lastEditedAt` set).
6. ✅ Word-budget violation surfaces a warning chip; the script still saves.
7. ✅ Regenerate overwrites the prior `Script` row; no orphan rows in DB.
8. ✅ Prompt cache reads register in `ApiUsage` for the second script generated against the same chapter (within 5-min TTL).
9. ✅ `pnpm test` green; `pnpm smoke:phase3` exits 0.
10. ✅ All work committed; `phase-3-complete` tag exists.

## Open follow-ups (not blocking Phase 3)

- "Generate 3 hook variants" mode (single Claude call returning alt hooks).
- Inline editor diff highlighting on regenerate.
- Series-aware generation (uses `seriesId` from Phase 2 to write cross-references).
- Niche style-guide editing UI (`NICHE_STYLE_GUIDE` is currently a constant).
- Auto-suggest hashtag candidates from trend keywords.
