# Faceless Content Pipeline — Design Spec

**Date:** 2026-05-19
**Status:** Approved by user, ready for implementation planning
**Project root:** `/Users/vkrish/Documents/projects/faceless-pipeline`

---

## 1. Overview & goals

A local-first desktop tool (Mac M3) that automates faceless short-form video creation from finance books. The user uploads a book PDF, the tool extracts chapters, Claude derives viral-worthy ideas per chapter, scores them against current trend signals, generates full scripts + posting metadata, fetches matching stock b-roll, synthesizes voiceover locally, and renders polished 1080×1920 videos using Remotion.

**Output:** ready-to-upload MP4s + per-platform metadata (title, caption, hashtags, thumbnail concept) for YouTube Shorts, Instagram Reels, and TikTok.

**Style:** kinetic typography + b-roll motion + animated chart overlays. No character on screen in MVP.

**Target:** 10–15 videos per chapter, one chapter at a time, end-to-end in <30 minutes on M3.

### Locked technical decisions

| Decision | Choice |
|---|---|
| App architecture | Single Next.js 15 (App Router) monolith with internal `packages/*` |
| Database | SQLite via Prisma |
| Queue | In-process `p-limit` + `p-queue`, no Redis |
| LLM | `claude-sonnet-4-6` for all Claude calls |
| TTS | Piper (local, free) — Ryan + Amy voices preloaded |
| Word timing | whisper.cpp (local, Apple Silicon optimized) |
| B-roll source | Pexels API (photos + videos), local-folder fallback |
| Trend signals | Google Trends (unofficial) + Reddit JSON API |
| Animation engine | Remotion (React → MP4) |
| Character / lip-sync | NOT in MVP (Phase 8+) |
| Auto-upload to platforms | NOT in MVP (manual upload from `/output/`) |
| Multi-niche / multi-channel | NOT in MVP (one tool instance per niche) |

---

## 2. End-to-end user flow

```
1. UPLOAD
   Drop a PDF book into the studio.
   → pdf-parse extracts text + page boundaries
   → chapter detector returns 3-30 chapters
   → shows: "Detected N chapters. Review?"

2. CHAPTER REVIEW
   List of chapters with title + page range. User can merge/split/
   rename/delete. User picks ONE chapter to work on first.

3. IDEA EXTRACTION + TREND FETCH (parallel)
   - Claude reads chapter → returns 3-8 "viral ideas"
     each with title, summary, target length, source quotes, candidate hooks
   - Backend pulls Google Trends + Reddit for chapter keywords

4. SCORING & SUGGESTIONS
   - Each idea scored 0-100 via Claude + trend data
   - Auto-suggestions surface: merge / split / drop / part-2 / reframe
   - UI sorts ideas by score, shows badges and dismissible suggestion cards

5. SCRIPT GENERATION + RE-SCORE
   - User approves idea set → 1 Claude call per idea, parallel
   - Each script: hook, body, CTA, visualBeats[], metadata{}
   - Scripts re-scored after generation (polished version != raw idea)

6. SCRIPT REVIEW
   - Inline edit hook/body/CTA/keywords
   - View generated YouTube title, caption, hashtags, thumbnail concept

7. B-ROLL PICKER
   - Per visual beat: 5 thumbnails from Pexels (photos or videos based on Claude's tag)
   - User picks one, or "Auto-pick top" to skip
   - Drag-drop local files as fallback

8. RENDER QUEUE
   - Live dashboard, status per render: voice → captions → assemble → render → bundle
   - Click thumbnail to preview MP4 in-app
   - "Open output folder" reveals MP4 + .txt metadata
```

Every stage has back-navigation. Editing a script does not invalidate already-rendered earlier scripts; re-rendering a script does not redo Claude or voice unless the script text changed.

---

## 3. Architecture

```
faceless-pipeline/
├── apps/
│   └── studio/                     # Next.js 15 (App Router)
│       ├── app/                    # UI routes
│       ├── app/api/                # REST API routes
│       └── server/                 # backend logic, imported by api routes
├── packages/
│   ├── remotion/                   # Remotion video composition (React)
│   ├── pipeline/                   # orchestrator: script-gen, voice, captions, render
│   ├── parsers/                    # pdf-parse + chapter detection
│   ├── trends/                     # Google Trends + Reddit clients
│   ├── tts/                        # Piper wrapper + voice management
│   ├── captions/                   # whisper.cpp wrapper
│   └── assets/                     # Pexels client + local cache
├── assets/                         # broll cache, manual images, piper voices, whisper models
├── output/                         # final MP4 + metadata bundles
├── data/                           # SQLite db file
├── logs/                           # daily-rotated pino logs
└── scripts/                        # smoke tests, setup scripts, cleanup utilities
```

**One process.** Next.js API routes invoke the `pipeline` package directly. Concurrency via `p-limit` (5 parallel Claude calls, 2 parallel Remotion renders). WebSockets via Next.js custom server for live render status. No Redis, no separate worker process.

**Boundary discipline:** Remotion is invoked via its CLI with a JSON props file — it never imports from `pipeline` or touches the DB. Clean process boundary makes it trivial to re-render from saved `render-input.json`.

---

## 4. Data model

SQLite via Prisma. Single file at `data/studio.db`.

```prisma
model Book {
  id          String    @id @default(cuid())
  title       String
  filePath    String              // /uploads/<id>.pdf
  niche       String              // "finance" for now
  pageCount   Int
  status      String              // parsed | scripting | done
  createdAt   DateTime  @default(now())
  chapters    Chapter[]
}

model Chapter {
  id          String   @id @default(cuid())
  bookId      String
  book        Book     @relation(fields: [bookId], references: [id])
  title       String
  orderIndex  Int
  startPage   Int
  endPage     Int
  rawText     String              // extracted chapter body
  status      String              // pending | ideated | scripted | done
  ideas       Idea[]
}

model Idea {
  id              String   @id @default(cuid())
  chapterId       String
  chapter         Chapter  @relation(fields: [chapterId], references: [id])
  title           String
  summary         String
  targetLengthSec Int                 // 15 | 30 | 60 | 90
  score           Int?                // 0-100, null until scored
  scoreBreakdown  Json?
  trendSignals    Json?
  flags           Json?               // ["series_candidate", "merge_with:xyz"]
  seriesId        String?             // groups multi-part series
  status          String              // raw | scored | approved | scripted | dropped
  script          Script?
}

model Script {
  id           String   @id @default(cuid())
  ideaId       String   @unique
  idea         Idea     @relation(fields: [ideaId], references: [id])
  hook         String
  body         String
  cta          String
  visualBeats  Json                // [{ start, end, keywords[], mediaType, tone, pickedAssetId? }]
  metadata     Json                // { youtubeTitle, caption, hashtags[], thumbnailConcept }
  score        Int?
  status       String              // draft | approved | rendering | done | failed
  render       Render?
}

model Asset {
  id          String   @id @default(cuid())
  scriptId    String?
  beatIndex   Int?
  type        String              // pexels_photo | pexels_video | manual | chart
  sourceUrl   String?
  localPath   String              // /assets/cache/<hash>.<ext>
  keyword     String?
  pickedAt    DateTime?
}

model Render {
  id           String    @id @default(cuid())
  scriptId     String    @unique
  script       Script    @relation(fields: [scriptId], references: [id])
  audioPath    String?
  captionsPath String?
  videoPath    String?
  metadataPath String?
  durationSec  Float?
  fileSizeMB   Float?
  status       String              // queued | voice | captions | render | bundle | done | failed
  progress     Int       @default(0)
  error        String?
  startedAt    DateTime?
  completedAt  DateTime?
}

model TrendSnapshot {                  // 24h cache
  id          String   @id @default(cuid())
  keyword     String
  source      String              // google_trends | reddit
  data        Json
  fetchedAt   DateTime @default(now())

  @@unique([keyword, source])
}

model ApiUsage {                       // cost & quota tracking
  id        String   @id @default(cuid())
  service   String              // anthropic | pexels | reddit | google_trends
  endpoint  String
  tokensIn  Int?
  tokensOut Int?
  costUsd   Float?
  traceId   String?
  createdAt DateTime @default(now())
}
```

**Status fields** drive UI state machines. **Idempotent stages**: re-running any worker stage overwrites prior artifacts. No rollback logic needed.

---

## 5. Pipeline internals

### 5.1 Book parsing (PDF → chapters)

- Library: `pdf-parse` (fallback: `pdfjs-dist` if edge cases hit)
- Chapter detection:
  1. Regex for "Chapter N", "Ch. N", Roman numerals, "Part N"
  2. Typographic heading heuristic (line starts/ends, ≤8 words, surrounded by blank lines)
  3. Fallback: split into ~4000-word blocks if no headings detected
- User edits in UI persist; we don't re-detect.

### 5.2 Idea extraction (1 Claude call per chapter)

- Model: `claude-sonnet-4-6`
- Prompt caching: chapter text cached as system block — reused across idea extraction, scoring, script gen, and re-score
- Output schema:
  ```json
  {
    "ideas": [{
      "title": "<7-12 words, hook-like>",
      "summary": "<1-2 lines>",
      "targetLengthSec": 15|30|60|90,
      "sourceQuotes": ["<exact chapter quotes>"],
      "candidateHooks": ["<2-3 alt first lines>"]
    }]
  }
  ```

### 5.3 Trend fetching (parallel, cached)

Runs in parallel with idea extraction. Per-keyword (chapter title + 5 noun-phrases):

- **Google Trends:** `google-trends-api` npm package, `interestOverTime` last 7 days, normalized 0–100. `p-limit(3)`. Cache 24h.
- **Reddit:** native fetch to `https://www.reddit.com/r/<sub>/search.json?q=<keyword>&t=week&sort=top`. Finance subs: `personalfinance, investing, financialindependence, wallstreetbets, stocks, options, fire`. `p-limit(5)`. Cache 24h.

On source failure, set that signal to `null` and continue.

### 5.4 Scoring (1 Claude call per idea, `p-limit(5)`)

Rubric:

| Component | Range | Signal |
|---|---|---|
| hook_strength | 0–25 | Pattern-interrupt, specificity, curiosity gap |
| specificity | 0–20 | Concrete numbers, named entities, sharp claim |
| trend_alignment | 0–25 | Google Trends + Reddit data |
| format_fit | 0–15 | Works in target seconds, one big idea |
| shelf_life | 0–15 | Evergreen (high) vs news-spike (low) |

Output:
```json
{
  "score": 87,
  "breakdown": { "hook_strength": 22, "specificity": 18, "trend_alignment": 20, "format_fit": 14, "shelf_life": 13 },
  "reasoning": "<2-3 lines>",
  "flags": ["series_candidate" | "merge_with:<idea_id>" | "drop_recommended" | "reframe"]
}
```

Score is presented as a heuristic ranking signal, **not** a real retention prediction.

### 5.5 Auto-suggestions (1 Claude call per chapter, all-ideas pass)

Output:
```json
{
  "merges":   [{ "ideaIds": ["a","b"], "reason": "...", "combinedTitle": "..." }],
  "splits":   [{ "ideaId": "c", "parts": [{ "title": "Part 1: ..." }, ...], "reason": "..." }],
  "drops":    [{ "ideaId": "d", "reason": "..." }],
  "series":   [{ "ideaIds": ["e","f","g"], "title": "<series name>", "reason": "..." }],
  "reframes": [{ "ideaId": "h", "altHooks": ["...", "...", "..."] }]
}
```

UI: dismissible suggestion cards above the idea list. Accept → mutates `Idea` rows.

### 5.6 Script generation (1 Claude call per approved idea, `p-limit(5)`)

Word budget: `2.5 × targetLengthSec` (e.g., 75 words for 30s).

Output schema:
```json
{
  "hook": "<first 3 seconds, pattern-interrupt>",
  "body": "<the explanation, one idea>",
  "cta": "<final 2 seconds, clear ask>",
  "visualBeats": [
    { "start": 0, "end": 3,  "keywords": ["..."], "mediaType": "photo|video", "tone": "urgent|explainer|payoff" }
  ],
  "metadata": {
    "youtubeTitle":    "<=60 chars",
    "caption":         "<2-3 lines>",
    "hashtags":        ["#finance", "#investing"],
    "thumbnailConcept": "<text + visual idea>"
  }
}
```

Claude attaches `chart: ChartSpec` to data-heavy beats:
```json
"chart": { "kind": "stat|bar|line", "label": "...", "bigNumber": "10.2%" }
```

### 5.7 Re-score (1 Claude call per script)

After scripts written, re-score using actual hook/body. Updates `Script.score`.

### 5.8 B-roll fetch (Pexels)

- Setup: free `PEXELS_API_KEY` in `.env.local`
- Per beat: query `/v1/search` (photos) or `/videos/search` based on `mediaType`
- Cache search results 24h
- UI: 5 thumbnails per beat → user picks one, or "Auto-pick top"
- Local fallback: drag-drop file → `/assets/manual/` → `Asset` row with `type: "manual"`
- Empty state: refined-keyword input + manual upload

### 5.9 Voice synthesis (Piper)

- Setup: `brew install piper-tts`; ONNX voice models in `/assets/voices/`
- Preloaded: `en_US-ryan-high` (male, authoritative) + `en_US-amy-medium` (female, friendly)
- Default voice picker in settings (per niche)
- Generation:
  ```bash
  echo "<script>" | piper --model /assets/voices/<voice>.onnx --output_file /output/<script_id>/audio.wav
  ```
- ~5× realtime on M3 (30s script → ~6s)
- Output: WAV @ 22.05 kHz → `Render.audioPath`

### 5.10 Word-level captions (whisper.cpp)

- Setup: `brew install whisper-cpp`; `ggml-small.en.bin` model in `/assets/whisper/`
- Generation:
  ```bash
  whisper-cpp -m /assets/whisper/ggml-small.en.bin --output-json --max-len 1 audio.wav
  ```
- `--max-len 1` forces one word per segment
- Output: `{ words: [{ word, start, end }] }` → `Render.captionsPath`

### 5.11 Worker orchestration (per script)

```
parallel:
  - voice (Piper)
  - assets (Pexels download for unresolved beats)
↓
captions (whisper, on Piper output)
↓
compose (Remotion CLI)
↓
bundle (write metadata.txt, thumbnail.jpg)
```

Per-stage progress writes to `Render.progress` (0–100).

---

## 6. Remotion composition

### 6.1 Layout

```
packages/remotion/
├── src/
│   ├── Root.tsx
│   ├── Video.tsx                // top-level <Composition>
│   ├── scenes/
│   │   ├── HookScene.tsx
│   │   ├── BeatScene.tsx
│   │   ├── ChartScene.tsx
│   │   └── CtaScene.tsx
│   ├── components/
│   │   ├── KineticCaption.tsx   // word-by-word highlight
│   │   ├── BRollImage.tsx       // ken-burns + fade
│   │   ├── BRollVideo.tsx       // looped video w/ overlay
│   │   ├── SlideUpCard.tsx
│   │   └── ChartReveal.tsx
│   ├── theme/
│   │   ├── tokens.ts
│   │   └── finance.ts           // finance-dark variant
│   └── data/types.ts            // RenderInput JSON contract
```

### 6.2 RenderInput contract

```ts
export type RenderInput = {
  scriptId: string;
  durationFrames: number;
  fps: 30;
  width: 1080;
  height: 1920;
  audioPath: string;
  captions: { words: { word: string; start: number; end: number }[] };
  visualBeats: {
    start: number;
    end: number;
    tone: "urgent" | "explainer" | "payoff";
    assetPath: string;
    assetType: "photo" | "video";
    chart?: ChartSpec;
  }[];
  theme: "finance-dark" | "finance-light";
  metadata: { youtubeTitle: string; caption: string; hashtags: string[]; thumbnailConcept: string };
};

export type ChartSpec = {
  kind: "bar" | "line" | "stat";
  label: string;
  data?: number[];
  bigNumber?: string;
};
```

### 6.3 Visual language (theme tokens)

```ts
export const financeDark = {
  bg: "#0B0F1A",
  textPrimary: "#FFFFFF",
  textHighlight: "#00FF85",       // current-word highlight
  accent: "#FFD700",               // chart bars
  font: "Inter",
  captionSize: 96,
  captionStroke: 8,
  captionPosition: "bottom-third",
  bRollKenBurns: { from: 1.0, to: 1.08, durationSec: 4 },
  enterEasing: "easeOutBack",
};
```

### 6.4 Animation primitives

- **Ken-burns on photos:** scale 1.0 → 1.08 over beat duration
- **Slide-up cards:** `spring()` entrance, `translateY: 100% → 0%`
- **Word-by-word caption highlight:** current word colored + scale 1.0 → 1.1
- **Chart bar grow:** `interpolate` 0% → target%, `Easing.bezier(0.16, 1, 0.3, 1)`
- **Beat transitions:** 4-frame cross-fade between scenes

### 6.5 Chart kinds (MVP)

- **stat** — one big number + label ("10.2%", "$10,000")
- **bar** — comparison of 2–4 values
- **line** — simple trend
- All plain React + SVG, no external chart libs.

### 6.6 Background music (off by default)

`/assets/music/` with 5 royalty-free loops (urgent, calm, motivational, etc.). Toggle in settings. When enabled, worker picks a track matching the script's dominant tone and mixes at -18dB beneath the voiceover.

### 6.7 Render invocation

```bash
npx remotion render \
  packages/remotion/src/index.ts \
  Video \
  /output/<script_id>/video.mp4 \
  --props=/output/<script_id>/render-input.json \
  --concurrency=4 \
  --x264-preset=fast
```

Up to **2 renders in parallel** (40-core GPU is the bottleneck). A 30s script renders in ~30s.

### 6.8 Output bundle

```
/output/<book-slug>/<chapter-slug>/<script-id>/
├── video.mp4              # 1080×1920 H.264
├── thumbnail.jpg          # first-frame extract OR concept render
├── metadata.txt           # title, caption, hashtags, thumbnail concept, score
└── debug/
    ├── audio.wav
    ├── captions.json
    ├── render-input.json  # re-renderable
    └── score.json
```

`metadata.txt` format:
```
=== YOUTUBE SHORTS ===
Title: <youtubeTitle>

=== INSTAGRAM / TIKTOK CAPTION ===
<caption>

<#hashtags joined>

=== THUMBNAIL CONCEPT ===
<thumbnailConcept>

=== SCORE: <n>/100 ===
hook_strength <n>/25 · specificity <n>/20 · trend_alignment <n>/25 · format_fit <n>/15 · shelf_life <n>/15

Reasoning: <reasoning>
```

### 6.9 Re-renders

`render-input.json` is persisted so the user can:
- Swap theme (dark → light) and re-render
- Swap a single b-roll asset and re-render
- No Claude/Piper/whisper re-runs needed unless script text changed

---

## 7. Phased rollout

### Phase 0 — Scaffold & smoke (Day 1)

Goal: every external dependency proven to work.
- Next.js 15 + Tailwind + shadcn/ui + Prisma + SQLite
- `.env.local` wired with `ANTHROPIC_API_KEY` + `PEXELS_API_KEY`
- Smoke scripts: `claude-hello`, `piper-hello`, `whisper-hello`, `remotion-hello`, `pexels-hello`
- `/health` route + system-status panel
- **Acceptance:** every smoke exits 0.

### Phase 1 — Book → Chapters → Ideas (Days 2–3)

- PDF upload UI + `parsers/` package
- Chapter review screen (merge/split/rename/delete)
- Claude idea extraction with prompt caching
- Idea cards UI
- **Acceptance:** PDF → 3–8 idea cards per chapter, persisted.

### Phase 2 — Scoring & suggestions (Days 4–5)

- `trends/` package: Google Trends + Reddit clients with retry + cache
- `TrendSnapshot` table populated
- Claude scoring + suggestions passes
- Score badges (color-coded) + suggestion cards (Accept/Dismiss)
- **Acceptance:** scores arrive in ~30s; suggestions are one-click actionable.

### Phase 3 — Scripts + metadata (Days 6–7)

- Approve UI → Claude script generation (`p-limit(5)`)
- Script review with inline edit
- Re-score on save
- Metadata block displayed (title, caption, hashtags, thumbnail concept)
- **Acceptance:** approve 5 ideas → 5 full scripts in <60s.

### Phase 4 — Audio + captions (Days 8–9)

- Settings: voice picker (Ryan/Amy)
- Piper + whisper.cpp subprocess workers
- Inline audio player in script card
- **Acceptance:** approve → audio playable in ~6–10s with word timings.

### Phase 5 — B-roll picker (Days 10–11)

- Pexels client + 24h cache
- Per-beat thumbnail picker (5 options)
- Auto-pick mode
- Local-folder fallback (drag-drop)
- **Acceptance:** 5-beat script gets 5 thumbnail sets in <5s.

### Phase 6 — Remotion render (Days 12–14)

- `packages/remotion/` scaffold + scenes + components
- `RenderInput` contract
- Theme: finance-dark
- Chart variants (stat/bar/line)
- Output bundle generator
- **Acceptance:** Render button → 30–60s → MP4 plays at 1080×1920 with all overlays.

### Phase 7 — Render queue dashboard + polish (Days 15–16)

- WebSocket live status (Next.js custom server + `ws`)
- Per-render progress bars
- "Open output folder" (Finder reveal)
- Retry on failure
- Background music toggle
- Empty states, error toasts, keyboard shortcuts
- **Acceptance:** Render All on 10 scripts → 10 MP4s + metadata in 5–10 min.

### Out of MVP scope (Phase 8+)

- Character on screen + lip-sync (Rhubarb)
- YouTube Data API trend source
- Platform auto-upload
- Per-platform variants (Shorts vs Reels vs TikTok cuts)
- Multi-niche / multi-channel
- Channel analytics feedback loop
- Remotion Studio live preview

### Effort estimate

~16 working days (~3 weeks at 6 hrs/day or 2 weeks at 8 hrs/day). If we must compress, **Phase 7 is the cut** — terminal logs while the UI is bare. Phases 0–6 are non-negotiable.

### Definition of done (MVP)

> Upload a finance book PDF → review chapters → for one chapter, see scored ideas with suggestions → approve and accept suggestions → 10–15 scripts generated → b-roll picked → render all → 10–15 ready-to-upload MP4s + metadata files in `/output/<book>/<chapter>/`. End-to-end on M3, under 30 minutes per chapter.

---

## 8. Error handling, testing, ops

### 8.1 Failure modes

| Stage | Failure | Handling |
|---|---|---|
| PDF parse | Encrypted / scanned PDF | Detect empty text → UI error: "Please OCR first" |
| PDF parse | No headings detected | Fall back to fixed-size blocks + banner |
| Claude API | 429 / 5xx | 3 retries, exp backoff (1s/4s/16s); fail row with visible error |
| Claude API | Malformed JSON | 1 self-correcting retry with parse error appended |
| Claude API | Timeout (>60s) | Treat as transient, retry |
| Google Trends | Library throws | `null` signal, score with remaining data |
| Reddit | 429 / 5xx | 3 retries; `null` and continue |
| Pexels | 0 results | UI empty state + refine keywords input |
| Pexels | 5xx | 3 retries; "add manually" message |
| Piper | Voice model missing | Block at startup: "run `pnpm setup:voices`" |
| Piper | Subprocess exits non-zero | Capture stderr → `Render.error` → `failed` |
| whisper.cpp | Model missing | Same: clear setup error |
| whisper.cpp | Empty word array | Fall back to evenly-distributed timing |
| Remotion | Render crash | Capture stderr → `failed`; render-input.json preserved |
| Disk | <2GB free | Pre-flight check; refuse with warning |

### 8.2 Retry helper

Single shared `retry(fn, { maxAttempts, baseMs, shouldRetry })` helper. Defaults per service. Subprocesses get max 1 retry.

### 8.3 Idempotency

Every stage overwrites its outputs. Re-running is always safe. "Retry" in UI = re-run that stage.

### 8.4 Testing

**Vitest unit tests** on pure functions only:
- `detectChapters(text)` with known PDF fixtures
- `captionsInBeat(words, beat)` boundary cases
- `scoreBreakdownSum(breakdown) === score`
- Prompt builder snapshots
- Pexels result normalizer

**One integration test** — orchestrator happy path with all externals mocked.

**Manual smoke tests per phase**, documented in `docs/smoke-tests.md`.

**Not tested:** Claude prompt quality, voice/visual aesthetics — evaluated by playing output.

### 8.5 Logging

- `pino` JSON to `/logs/studio-YYYY-MM-DD.log`
- Daily rotation, 14-day retention
- Every pipeline call tagged with `traceId` (= scriptId or renderId)
- Subprocess stderr captured + tagged
- `/admin/logs` UI page (Phase 7) for last 200 lines + filter by traceId

### 8.6 Cost tracking

`ApiUsage` table records each Claude/Pexels/Reddit/Trends call with tokens and est. cost. Header shows daily + per-book cost badge.

### 8.7 Data hygiene

- `/assets/cache/` — manual `pnpm prune:cache` removes unreferenced assets >30 days
- `/output/` — never auto-deleted (user product)
- `/logs/` — rotated daily, deleted after 14 days
- SQLite — manual backup `cp data/studio.db backup/`

### 8.8 Secrets

`.env.local` (gitignored):
- Required: `ANTHROPIC_API_KEY`, `PEXELS_API_KEY`
- Optional: `LOG_LEVEL`, `RENDER_CONCURRENCY` (default 2)

Settings UI shows masked previews so user can confirm what's loaded.

---

## 9. Open items deferred to implementation plan

- Exact Prisma migration files
- Detailed Claude prompts (full text vs the sketches in this spec)
- Specific shadcn/ui component selections per screen
- Pexels result-ranking heuristic (when API returns 50, which 5 to surface)
- Caption animation easing curves (final tune happens during Phase 6 iteration)
- Setup script (`pnpm setup`) sequencing for Piper voices and whisper models

These will be resolved in the writing-plans phase, not here.
