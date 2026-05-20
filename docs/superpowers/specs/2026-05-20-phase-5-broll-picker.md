# Phase 5 — B-Roll Picker (Pexels + Manual Fallback)

> Implementation phase for [[2026-05-19-faceless-content-pipeline-design]] §5.8 and the Phase 5 milestone in §7. Depends on [[2026-05-20-phase-3-scripts-and-metadata]] (`Script.visualBeats` populated) and reuses the Phase 0 Pexels client smoke.

## Goal

For each script's `visualBeats[]`, fetch 5 Pexels candidates (photos or videos based on `mediaType`), let the user pick one per beat (or auto-pick top), with drag-drop manual upload as a fallback. Picks persist as `Asset` rows linked back to the beat by `beatIndex`.

**Phase 5 is done when:** a 5-beat script gets 5 thumbnail sets in <5s, picking flows to DB, "Auto-pick top" works, manual upload integrates, and downloads are cached locally and gitignored.

## Architecture

```
┌────────────────── apps/studio ────────────────────┐
│  /books/[id]/chapters/[cid]/scripts/[sid]/broll    │
│    — per-beat row with 5 thumbnails + actions      │
│                                                     │
│  POST  /api/scripts/[id]/broll/fetch                │
│  POST  /api/scripts/[id]/broll/auto-pick            │
│  PATCH /api/scripts/[id]/beats/[idx]                │
│  POST  /api/scripts/[id]/broll/upload  (multipart)  │
│  GET   /api/assets/[id]/file        (streams file)  │
└──────────────────────┬─────────────────────────────┘
                       │
         ┌─────────────┼─────────────┐
         │             │             │
┌────────▼──┐  ┌───────▼───┐  ┌──────▼──────────┐
│ assets/   │  │ db        │  │ jobs/            │
│  pexels.ts│  │           │  │  fetch-broll.ts  │
│  cache.ts │  │           │  │                  │
│  download │  │           │  │                  │
└───────────┘  └───────────┘  └──────────────────┘
```

### Package boundaries

- **`packages/assets/`** — pure clients (`pexels.ts` already exists from Phase 0).
  - `searchPhotos(query, opts): Promise<PexelsPhotoResult[]>` — already implemented.
  - `searchVideos(query, opts): Promise<PexelsVideoResult[]>` — **new**, mirrors `searchPhotos` against `/videos/search`.
  - `rankResults(items, opts): T[]` — pure ranker; deterministic ordering for stability.
  - `downloadAsset(url, opts): Promise<{ localPath, bytes, contentType }>` — downloads to `assets/cache/<sha256>.<ext>`, idempotent (skips if hashed file already exists).
- **`packages/assets/src/cache.ts`** — DB-backed 24h search cache (own table; see Data model).
- **`apps/studio/lib/jobs/fetch-broll.ts`** — orchestrator. Per script, per beat: cache lookup → Pexels search → rank → download top 5 thumbs → upsert `Asset` rows. Top-5 thumbs only download `thumb` URLs; the full asset isn't downloaded until the user picks it.
- **`apps/studio/lib/uploads/manual.ts`** — handles multipart manual uploads: validates MIME, writes to `assets/manual/<scriptId>/<idx>-<basename>`, creates `Asset(type="manual")`.

## Data model

`Asset` already exists from Phase 0. Phase 5 populates `scriptId`, `beatIndex`, `type`, `sourceUrl`, `localPath`, `keyword`, `pickedAt`. New: a thin column to distinguish thumbs from full downloads.

```prisma
model Asset {
  // ...existing fields
  thumbPath  String?   // local cached thumbnail (for picker UI)
  durationSec Float?   // for video assets
  width      Int?
  height     Int?
}
```

New table for Pexels response caching (24h TTL, same pattern as `TrendSnapshot`):

```prisma
model PexelsCache {
  id        String   @id @default(cuid())
  queryKey  String   @unique           // sha256("<mediaType>|<query>|<perPage>")
  results   Json                       // raw Pexels response, normalized
  fetchedAt DateTime @default(now())
}
```

New `Script.visualBeats[i]` schema gains an optional `pickedAssetId: string` field, set when the user picks. (Persisted inside the existing `Script.visualBeats` JSON column — no DB migration.)

New `Job.type`: `"fetch_broll"`.

## User flow

### Entry point — broll page (`/books/[id]/chapters/[cid]/scripts/[sid]/broll`)

A dedicated route, linked from each script card via a **B-roll** button (visible when `Script.status ∈ {draft, approved}`).

Page layout: a vertical list, one row per beat. Each row:

- **Header:** "Beat N · {start–end}s · {tone} · {mediaType}" + the joined keywords (editable inline).
- **Thumbnails:** 5 image cards across. Each thumb has a hover-zoom + a "Pick" overlay button. The currently picked asset has a thicker primary-colored border + a small ✓ chip.
- **Row actions** (right side):
  - **Refine** — opens an inline keyword editor; on save, re-fetches just this beat.
  - **Upload manual** — drag-drop zone or file picker.
  - **Clear pick** — un-sets `pickedAssetId`.

### Bulk actions (script header)

- **Fetch all** — enqueues a single `fetch_broll` Job for the script. The job iterates beats, hitting cache where possible and Pexels otherwise, with `p-limit(5)` across beats.
- **Auto-pick top** — server picks the first ranked result per beat with `pickedAssetId === null`. Atomic. No new fetch unless beats lack candidates.
- **Re-fetch all** — same as Fetch all but invalidates `PexelsCache` rows for this script's queries first.

### Fetch flow

1. Click **Fetch all** → `POST /api/scripts/[id]/broll/fetch`. Server creates `Job(type="fetch_broll", targetType="Script", targetId=<sid>)`. Returns 202 `{ jobId }`.
2. Job stages (single job, observable via `Job.progress`):
   ```
   0  → 10:  load script + collect beat queries
   10 → 80:  per beat: cache hit OR pexels fetch → rank → thumb download
   80 → 100: upsert Asset rows + Job.result
   ```
3. UI polls the job. On completion, the page reloads beat rows (or hot-fetches via SWR) and thumbnails appear.

### Manual upload

1. User drags an image/video onto a beat row or clicks **Upload manual**.
2. Browser sends `POST /api/scripts/[id]/broll/upload` (multipart) with `beatIndex`.
3. Server validates: MIME `∈ {image/jpeg, image/png, image/webp, video/mp4, video/quicktime}`, size ≤ 50 MB, magic-bytes prefix check.
4. Writes to `assets/manual/<scriptId>/<idx>-<basename>`. Creates `Asset(type="manual", scriptId, beatIndex, localPath, thumbPath=localPath)`. For videos, runs ffprobe to capture `durationSec`/`width`/`height`. (FFmpeg already in master-spec prerequisites.)
5. Returns the new asset record. Client auto-picks it for that beat unless one is already picked (in which case asks "replace?").

### File streaming

`GET /api/assets/[id]/file` reads `Asset.localPath` and streams with the correct `Content-Type`. Range support for videos (same helper used in Phase 4 audio streaming).

## Pexels client internals

### Photo search

Already implemented (Phase 0). Adds an `orientation=portrait` param and `size=large` to bias toward 9:16-friendly assets:

```ts
const url = `https://api.pexels.com/v1/search?query=${q}&per_page=${perPage}&orientation=portrait&size=large`;
```

### Video search (`searchVideos`, new)

```ts
const url = `https://api.pexels.com/videos/search?query=${q}&per_page=${perPage}&orientation=portrait`;
const res = await fetch(url, { headers: { Authorization: opts.apiKey } });
// Normalize: pick the smallest video_file with height ≥ 1080 and width ≤ 1280
```

Returns:

```ts
type PexelsVideoResult = {
  id: number;
  thumb: string;       // image preview
  full: string;        // mp4 URL chosen by height-rule
  width: number;
  height: number;
  durationSec: number;
};
```

### Ranking (`rankResults`)

Pure, deterministic:

- **Photos:** sort by `|aspectRatio − (9/16)|` ascending; tie-break by `id` ascending.
- **Videos:** filter to `durationSec ≤ 30 && height ≥ 1080`; sort by `|aspectRatio − (9/16)|`; tie-break by `id`.
- After sort, take first 5.

### Cache

- `queryKey = sha256(`${mediaType}|${normalizedQuery}|${perPage}`)`.
- `normalizedQuery = query.toLowerCase().trim()`.
- Hit if `fetchedAt > now − 24h`. Otherwise fetch, upsert, return.

### Download

`downloadAsset(url, { destDir })`:

1. `hash = sha256(url)`.
2. `ext` parsed from URL path; allowlisted (`.jpg|.jpeg|.png|.webp|.mp4|.mov`).
3. `localPath = ${destDir}/${hash}${ext}`.
4. If file exists, skip; return path.
5. Stream-download with 30s timeout; verify byte count > 1 KB.
6. Return `{ localPath, bytes, contentType }`.

Phase 5 downloads only `thumb` URLs (small, fast). Full assets are downloaded lazily by the Phase 6 render job, on demand, when their `Asset` is referenced as `pickedAssetId`.

## Error handling summary

| Failure | Behavior |
|---|---|
| Pexels 0 results for a beat | UI empty state: refine keywords or upload manually |
| Pexels 5xx | 2× retry; final failure → empty state with "try again or upload" |
| Pexels 401/403 | Surface "check PEXELS_API_KEY" — pre-flight in `/health` should already catch this |
| Download timeout (>30s) | Skip the thumb; UI shows a placeholder; user can refresh |
| Manual upload MIME mismatch | 400 with explicit error; no file written |
| Manual upload >50 MB | 413; no file written |
| Disk < 1 GB free at job start | Refuse; `Render.error="disk_low"` |
| User picks an asset that was meanwhile evicted from cache | Cache eviction does not delete `Asset` rows; pick still works |
| HMR / process restart with running fetch_broll | Phase 1 orphan recovery: `failed`, error="interrupted" |

## Testing strategy

### Unit (TDD red → green)

- `packages/assets/src/pexels.test.ts` — extend Phase 0 tests with `searchVideos` happy + 5xx-retry.
- `packages/assets/src/rank.test.ts` — `rankResults`:
  - 9:16 photo wins over square,
  - tie-break by id is stable,
  - video duration filter excludes >30s.
- `packages/assets/src/cache.test.ts` — `cacheKey`, `getCached` (within TTL hit, outside miss), `upsertCache`.
- `packages/assets/src/download.test.ts` — mocked fetch; verify hash path, skip-if-exists, byte-count guard.
- `apps/studio/lib/uploads/manual.test.ts` — MIME validator, magic-bytes validator, size cap.
- `apps/studio/lib/jobs/fetch-broll.test.ts` — orchestrator: 5-beat fixture, mocked Pexels, mocked downloader → 25 Asset rows + 5 with thumb paths.

### Integration

- `apps/studio/lib/jobs/fetch-broll.integration.test.ts` — end-to-end against fixture script with 3 beats and mocked HTTP for Pexels; asserts Asset rows persisted, thumbs on disk, beat picker UI hydrates correctly via the assets API.

### Smoke

- `scripts/smoke/phase5-hello.ts` — **real** Pexels API call for one photo + one video query. Asserts 5+ photo results, 1+ video result, and one downloaded thumb file >2 KB. Registered as `pnpm smoke:phase5`. Cheap (free tier). Not in `smoke:all`.

### Manual UI verification (acceptance)

- On a Phase 3 script with 5 beats, open the broll page, click **Fetch all** → 5 sets of 5 thumbs in <5s on M3 → click thumbs to pick → reload preserves picks → upload a local JPG → it appears in the picker → Auto-pick top fills remaining.

## Out of scope (Phase 6+)

- Video segment trimming / in-point selection (we render the full source clip with looping if needed).
- Multi-pick per beat (we store one `pickedAssetId`).
- Asset library page (`/assets`) for browsing across scripts.
- AI re-ranking based on script tone embedding.
- Stable Diffusion / generative b-roll fallback.
- Pexels video high-res variant negotiation beyond the simple height rule.

## Acceptance criteria

1. ✅ 5-beat script gets 5 thumbnail sets in <5s on M3.
2. ✅ Auto-pick fills every beat lacking `pickedAssetId`; clicking it twice is a no-op (no DB churn).
3. ✅ Manual upload of a 5 MB JPG completes in <2s, appears in the picker, and auto-picks if the beat is empty.
4. ✅ Refining a beat's keywords and re-fetching returns a different result set (or the same with a `cache_hit=false` flag).
5. ✅ Disabling network and re-fetching within 24h still returns the cached results.
6. ✅ Picked assets survive `pnpm dev` restart.
7. ✅ Thumbnails live under `assets/cache/`; manuals under `assets/manual/`; both are gitignored.
8. ✅ `pnpm test` green; `pnpm smoke:phase5` exits 0.
9. ✅ All work committed; `phase-5-complete` tag exists.

## Open follow-ups (not blocking Phase 5)

- "Save to favorites" — pin an asset across scripts (cross-script reuse).
- Bulk-replace all picks for a script in one click.
- Asset library page `/assets` with search across cached `Asset` rows.
- Multiple picks per beat (Remotion would cycle them) — needs schema work.
- Background full-asset prefetch for top picks so Phase 6 render starts faster.
