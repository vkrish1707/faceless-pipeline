# Phase 1 — Book → Chapters → Ideas

> Implementation phase for [[2026-05-19-faceless-content-pipeline-design]] §5.1, §5.2, and the Phase 1 milestone in §7.

## Goal

A user uploads a finance-book PDF, optionally edits the auto-detected chapter list, and triggers per-chapter Claude extraction. Each chapter produces 3–8 idea cards persisted to SQLite.

**Phase 1 is done when:** a real PDF → idea cards round-trip works end-to-end via the studio UI, with all artifacts persisted.

## Architecture

```
┌──────────── apps/studio ────────────┐
│  /books/new        ── upload form    │
│  /books/[id]       ── chapter editor │
│  /books/[id]/      ── idea cards     │
│         chapters/[cid]               │
│                                       │
│  /api/books              POST        │
│  /api/chapters/[id]      PATCH | DEL │
│  /api/chapters/[id]/split   POST     │
│  /api/chapters/[id]/extract POST     │
│  /api/jobs/[id]          GET (poll)  │
└───────────────┬──────────────────────┘
                │
       ┌────────┼─────────┐
       │        │         │
┌──────▼────┐ ┌─▼────┐ ┌──▼─────────┐
│ parsers/  │ │ db   │ │ extract.ts │
│ pdf.ts    │ │      │ │ (job impl) │
│ chapters  │ │      │ │            │
└───────────┘ └──────┘ └──┬─────────┘
                          │
                  ┌───────▼────────┐
                  │ Anthropic SDK  │
                  │ + prompt cache │
                  └────────────────┘
```

### Package boundaries

- **`packages/parsers/`** — pure functions. No DB, no filesystem.
  - `parsePdf(buffer: Buffer): Promise<{ pageCount: number; pages: string[] }>`
  - `detectChapters(pages: string[], opts?: { minBlockWords?: number }): Chapter[]` where `Chapter = { title: string; orderIndex: number; startPage: number; endPage: number; rawText: string }`.
- **`packages/pipeline/extract.ts`** — pure idea-extraction function.
  - `extractIdeas({ chapterText, apiKey, model? }): Promise<{ ideas: Idea[]; usage: { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens } }>` where `Idea = { title, summary, targetLengthSec, sourceQuotes, candidateHooks }`.
  - Caller persists; this function does not.
- **`apps/studio/lib/jobs/`** — the job runner that wraps the pipeline call, writes to `Job`/`Idea`/`ApiUsage`, and handles error/retry. Next.js API routes only call into here.

## Data model additions

```prisma
model Job {
  id          String    @id @default(cuid())
  type        String    // "extract_ideas" today; future: "score" | "render" | ...
  status      String    // "queued" | "running" | "completed" | "failed"
  progress    Int       @default(0)  // 0-100
  error       String?
  targetType  String    // "Chapter" | "Idea" | ...
  targetId    String
  payload     Json?     // job-specific input
  result      Json?     // job-specific output summary
  startedAt   DateTime?
  completedAt DateTime?
  createdAt   DateTime  @default(now())

  @@index([targetType, targetId, type])
  @@index([status])
}
```

Existing `Idea` model gains two columns (already named in the master spec §5.2 but not migrated in Phase 0):

```prisma
model Idea {
  // ...existing fields
  sourceQuotes    Json?
  candidateHooks  Json?
}
```

Migration is additive — no data backfill required.

## User flow

### Upload (synchronous, ~1–2s)

1. `/books/new` — form with: file input (PDF), niche select (`personal_finance | investing | entrepreneurship | psychology | other`), optional title override.
2. Submit → `POST /api/books` (multipart). Server:
   - Validates: MIME `application/pdf`, size ≤ 50 MB, magic-bytes prefix `%PDF-`.
   - Writes the file to `assets/pdfs/<bookId>.pdf`.
   - Calls `parsePdf` then `detectChapters` (transactional).
   - Creates `Book` (`status="ready"`) + N `Chapter` rows (`status="pending"`).
3. Redirect to `/books/[id]`.
4. On parse failure (corrupt PDF, 0 chapters detected even after fallback): respond 400 with a typed error message; no `Book` row is created; the file written in step 2's first action is cleaned up.

### Chapter editor (`/books/[id]`)

- Vertical list, one row per chapter: `#` (orderIndex), title (inline-editable on click), page range, word count (from `rawText`), status badge, ideas-count badge.
- Per-row actions:
  - **Rename** — inline, PATCH `/api/chapters/[id]` with `{ title }`.
  - **Delete** — confirm modal, DELETE `/api/chapters/[id]`; remaining chapters get `orderIndex` re-numbered.
  - **Split** — modal shows `rawText` with paragraph breaks; click between paragraphs to set a split point; POST `/api/chapters/[id]/split` with `{ atOffset: number; newTitle: string }`. Server creates a new chapter row, re-numbers `orderIndex` for all subsequent chapters.
  - **Merge with next** — PATCH `/api/chapters/[id]` with `{ mergeWithNext: true }`; server appends next chapter's `rawText`, extends `endPage`, deletes the next row, re-numbers.
  - **Extract ideas** — enqueues a job (see below).
- Top: **Extract all** (fires one job per chapter that doesn't already have ideas), **Re-detect chapters** (destructive — drops all chapters + ideas for the book, re-runs `detectChapters` on the stored PDF; modal-confirm).

### Idea extraction (async, fire-and-forget)

1. Click "Extract ideas" → `POST /api/chapters/[id]/extract`. Server:
   - Creates a `Job` row: `{ type:"extract_ideas", status:"queued", targetType:"Chapter", targetId: chapterId, progress: 0 }`.
   - Invokes `runJob(jobId)` without awaiting (`runJob(jobId).catch(logToServer)`).
   - Returns `{ jobId }` immediately (HTTP 202).
2. UI polls `GET /api/jobs/[jobId]` every 2 seconds until `status ∈ {completed, failed}`. Stop polling on hidden-tab visibility change; resume on focus.
3. `runJob` transitions: `queued → running (progress=10) → [Claude call] → running (progress=80) → [persist Ideas + ApiUsage] → completed (progress=100)`.
4. On success: ideas are inserted into `Idea` table linked to the chapter; the chapter row's badge flips to "N ideas".
5. On failure: `Job.status="failed"`, `Job.error` set; the row shows the error with a "Retry" button (creates a new Job).
6. **Prompt caching:** chapter `rawText` is sent as a `system` block with `cache_control: { type: "ephemeral" }`. Token usage is logged into `ApiUsage` with the cache-read/creation breakdown.
7. **Internal retry:** Claude `429` and `5xx` retry up to 2x with exponential backoff inside the job before marking failed. `400`-class errors fail immediately.

### Idea cards (`/books/[id]/chapters/[cid]`)

- Grid of cards, one per idea. Each card shows: title, summary, target length pill (15/30/60/90s), `candidateHooks` (collapsible), `sourceQuotes` (collapsible).
- No accept/reject UI in Phase 1 — that lands in Phase 2 with scoring.
- "Re-extract" button on the chapter header: drops all `Idea` rows for this chapter, creates a new Job. Confirm modal — destructive.

## Parser internals

### `parsePdf`

- Library: `pdf-parse`.
- Returns `pages: string[]` — one entry per page, in order. `pdf-parse` exposes `pagerender` for per-page text; use it instead of the concatenated `text` field.
- Throws `PdfParseError` (typed) on corrupt input.

### `detectChapters`

Priority order (first that produces ≥2 chapters wins):

1. **Regex headings:** `^(Chapter\s+\d+|Ch\.\s*\d+|Part\s+\d+|[IVX]{1,5}\.?)(\s|$)` — case-insensitive, anchored at line start. Title = the heading line; body = text until the next heading or EOF.
2. **Typography fallback:** lines that are surrounded by blank lines, ≤ 8 words, and either ALL-CAPS or Title-Case. Use as candidate chapter starts.
3. **Word-block fallback:** if neither yields ≥ 2 chapters, split the document into ~4000-word blocks titled "Section 1", "Section 2", etc. Throws `NoChaptersDetectedError` only if the document has < 1000 total words.

Each detected chapter records its `startPage` and `endPage` based on which `pages[]` indices its text was drawn from.

The function also **skips a table-of-contents region** at the front: if the first detected "Chapter N" headings appear within the first 5% of total pages AND the same titles re-appear later in the document, treat the early occurrences as TOC and drop them.

## Pipeline: `extractIdeas`

### Request shape

```ts
client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 2048,
  system: [
    { type: "text", text: SYSTEM_PROMPT },
    { type: "text", text: chapterText, cache_control: { type: "ephemeral" } },
  ],
  messages: [{ role: "user", content: USER_PROMPT_TEMPLATE }],
});
```

`SYSTEM_PROMPT` instructs the model to return JSON matching the schema below. `USER_PROMPT_TEMPLATE` asks for 3–8 ideas.

### Output schema (validated with zod)

```ts
const IdeaSchema = z.object({
  title: z.string().min(3).max(120),
  summary: z.string().min(10).max(400),
  targetLengthSec: z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(90)]),
  sourceQuotes: z.array(z.string()).min(1).max(5),
  candidateHooks: z.array(z.string()).min(2).max(3),
});
const ResponseSchema = z.object({ ideas: z.array(IdeaSchema).min(1).max(10) });
```

A parse failure (Claude returned malformed JSON or missed the schema) is treated as a retryable error.

## Error handling summary

| Failure | Behavior |
|---|---|
| PDF too large (>50MB) | 400 from `/api/books`; no row created |
| PDF wrong MIME or magic bytes | 400; no row created |
| `pdf-parse` throws | 400 with the underlying message (sanitized) |
| 0 chapters detected after fallback | 400 with `NoChaptersDetectedError`; allow user to re-upload |
| Claude 429 / 5xx | Internal retry ×2 with exponential backoff |
| Claude 400 / schema fail | Job → `failed`; UI shows error + retry button |
| Claude returns 0 ideas | Job → `failed` with "model returned no ideas" |
| HMR / process restart with running jobs | On app start, mark `status="running"` jobs as `failed` with `error="interrupted"` |

## Testing strategy

### Unit (TDD red → green)

- `packages/parsers/src/pdf.test.ts` — fixture-based: page count, per-page text. Fixture: a 3-page PDF committed to `packages/parsers/test/fixtures/`.
- `packages/parsers/src/chapters.test.ts` —
  - regex detection on synthetic page array;
  - typography fallback when no regex matches;
  - word-block fallback when neither;
  - TOC stripping;
  - `NoChaptersDetectedError` on tiny input.
- `packages/pipeline/src/extract.test.ts` — mocked Anthropic SDK:
  - happy path returns parsed ideas + usage;
  - 429 retried then succeeded;
  - malformed JSON → throws after retries;
  - schema-fail → throws.
- `apps/studio/lib/jobs/runner.test.ts` —
  - orphan recovery on startup;
  - success transitions write `result` + `completedAt`;
  - failure transitions write `error`;
  - progress monotonically increases.

### Integration

- One Vitest: `apps/studio/lib/jobs/extract-job.test.ts` — runs `parsePdf → detectChapters → extractIdeas` against the fixture PDF with a mocked Anthropic client, then asserts the database state (Job completed, Ideas exist).

### Smoke

- `scripts/smoke/phase1-hello.ts` — uses a small **real** PDF fixture and a **real** Claude call. Asserts ≥1 idea returned from a known chapter. Registered as `pnpm smoke:phase1`. Not added to `smoke:all` (costs money each run) — invoked manually + by Task 14 of the implementation plan.

### Manual UI verification (Task at end of implementation)

- `pnpm dev`, upload a finance PDF, see chapters, edit one, extract ideas on one chapter, see cards. Acceptance per master spec §7 Phase 1.

## Out of scope (Phase 2+)

- Accept/reject UI for ideas
- Re-extraction with diff/merge (Phase 1 just replaces)
- Bulk import of multiple PDFs
- Real-time progress (SSE/WebSocket) — polling suffices for ~5–15s jobs
- `pdfjs-dist` fallback — add only if `pdf-parse` breaks on a real PDF the user actually wants
- Scoring, trends, suggestions (Phase 2)
- Book listing / dashboard refinements (Phase 7 polish)

## Acceptance criteria

1. ✅ User uploads a real finance PDF and lands on `/books/[id]` with 3+ chapters detected.
2. ✅ User can rename, delete, split, and merge chapters; changes persist across reload.
3. ✅ User clicks "Extract ideas" on a chapter; status badge cycles `queued → running → completed` within ~15s; ≥3 ideas appear on `/books/[id]/chapters/[cid]`.
4. ✅ All ideas include `title`, `summary`, `targetLengthSec`, `sourceQuotes`, `candidateHooks`.
5. ✅ Prompt cache hits register in `ApiUsage.cacheReadTokens > 0` on the second extraction of the same chapter (e.g. re-extract within the 5-min TTL).
6. ✅ `pnpm test` green (all new unit + integration tests pass).
7. ✅ `pnpm smoke:phase1` exits 0 against the fixture PDF.
8. ✅ All work committed; `phase-1-complete` tag exists.

## Open follow-ups (not blocking Phase 1)

- Make Job statuses observable in a dev-only `/jobs` debug page (deferred to Phase 7 polish).
- Decide on a global toast/notification surface for job completion (currently only the chapter-row badge updates).
- Add a `Book` listing page on `/` (currently `/` is just the system-status panel from Phase 0).
