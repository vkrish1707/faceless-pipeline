# Phase 7 — Render Queue Dashboard & Polish

> Implementation phase for [[2026-05-19-faceless-content-pipeline-design]] Phase 7 milestone in §7, plus the polish items in §8 (logging UI, cost tracking surface). Depends on every prior phase — this is the final layer.

## Goal

A live render dashboard that shows every in-flight and recent render with real-time progress (via WebSockets), retry-on-failure, output-folder reveal, background-music mixing, cost badges, and the usability polish items deferred from earlier phases.

**Phase 7 is done when:** the user clicks **Render All** on a chapter with 10 approved scripts, sees a live dashboard update without polling, gets 10 MP4s + metadata bundles in 5–10 minutes, can retry a failed render in one click, and can toggle background music on/off in settings.

## Architecture

```
┌────────────────── apps/studio ─────────────────────┐
│  /renders            — global dashboard             │
│  /admin/logs         — last 200 log lines           │
│  /settings           — adds music + concurrency     │
│                                                      │
│  WebSocket: /api/ws  (custom Next.js server + ws)   │
│  POST /api/renders/bulk         (Render All)        │
│  POST /api/renders/[id]/retry                       │
│  POST /api/renders/[id]/reveal  (already Phase 6)   │
└────────────────────────┬───────────────────────────┘
                         │
            ┌────────────┼────────────┐
            │            │            │
      ┌─────▼─────┐ ┌────▼────┐ ┌─────▼───────┐
      │ ws/       │ │ db      │ │ jobs/        │
      │  hub.ts   │ │         │ │  emit.ts     │
      │  server.ts│ │         │ │ (broadcasts) │
      └───────────┘ └─────────┘ └──────────────┘
                         │
                  ┌──────▼──────┐
                  │ ffmpeg mix  │  (background music)
                  └─────────────┘
```

### Package boundaries

- **`apps/studio/server.ts`** — custom Next.js server (replaces `next dev` / `next start`). Wraps the Next handler and attaches a `ws.Server` to the same HTTP port for `/api/ws` upgrades.
- **`apps/studio/lib/ws/hub.ts`** — connection registry. Tracks subscribers per scope (chapter id, render id, global). Exposes `broadcast(scope, event)`.
- **`apps/studio/lib/jobs/emit.ts`** — every job runner (Phase 1's `runJob`) calls `emit({ jobId, status, progress })` after each status mutation; emit publishes via `hub`.
- **`apps/studio/lib/music/`** — background-music selection + ffmpeg mix.
  - `pickTrack(beats): { path, gainDb }` — pure helper, deterministic.
  - `mixAudio(voicePath, musicPath, outPath): Promise<void>` — ffmpeg `amix` filter at −18 dB on music.

## Data model additions

```prisma
model Setting {
  // ...existing from Phase 4
  // new keys: "enable_music", "render_concurrency", "music_gain_db"
}
```

(No new tables. The `Setting` table from Phase 4 just gains new keys.)

## User flow

### Render All

1. On a chapter's script-review page (Phase 3), a header button **Render All (N ready)** appears, gated identically to per-script render: only counts scripts where audio + captions + all picks exist.
2. Click → `POST /api/renders/bulk { chapterId }`. Server enqueues `N` `render_script` jobs and returns `{ jobIds }`. App-wide `render_concurrency` (default 2) caps parallelism.
3. Client navigates to `/renders?chapter=<cid>` (the dashboard).

### Dashboard (`/renders`)

- Connects to `/api/ws` on mount, subscribes to `{ scope: "chapter:<cid>" }` (or `"global"` if no filter).
- Renders one row per render, sorted by:
  - in-flight first (status ∈ `voice|captions|render|bundle`),
  - then queued,
  - then completed (newest first),
  - then failed (newest first).
- Each row shows:
  - script title + chapter,
  - stage label (`voice → captions → render → bundle → done`),
  - progress bar (live via WS events),
  - elapsed/eta,
  - actions:
    - **Open folder** (per Phase 6),
    - **Retry** (visible on `failed` only),
    - **Play** (opens an inline modal with `<video>` once `done`).
- The header shows aggregate counts: `2 rendering · 1 queued · 7 done · 1 failed`.

### Retry

- `POST /api/renders/[id]/retry` → if `Render.status="failed"`:
  - Resets fields touched by the render stage (videoPath/metadataPath/error to null; status to `queued`).
  - Enqueues a fresh `render_script` Job.
  - Skips Phase 4 (audio/captions still on disk) and Phase 5 (picks unchanged) entirely.

### Settings (`/settings`) — additions

- **Background music** toggle (default off). When on, the synth pipeline (Phase 4) is unchanged; the **render** job (Phase 6) gains a music-mix stage between Remotion output and ffprobe.
- **Render concurrency** slider (1–4). Persisted; restart not required.
- **Log level** dropdown (`debug | info | warn | error`).
- **Music gain (dB)** number input (default `-18`).

### Open folder & toasts & shortcuts

- **Open folder** uses the Phase 6 helper, reachable from every render row.
- **Toasts** (using `sonner`, lightweight): on job completion the dashboard pops a "Render done" toast with an **Open** action. Suppressed when the dashboard tab is foreground (no double-notification with the row).
- **Keyboard shortcuts** (single-keystroke when no input focused):
  - `g r` → open `/renders`.
  - `r` → Render All on the current chapter page.
  - `o` → Open output folder for the focused row.
  - `?` → opens a shortcuts cheatsheet modal.

### Cost badge (header, all pages)

- A small chip next to the user/menu shows `$ X.XX today / $ Y.YY this book`.
- Driven by `ApiUsage` rows (created since Phase 1). Aggregated server-side, cached 30s.

### Admin logs (`/admin/logs`)

- Reads the last 200 lines of `logs/studio-<today>.log` via a server action.
- Filterable by `traceId` (matches `scriptId`/`renderId`).
- Tail mode: auto-refresh every 3s when toggled.
- Not protected — dev-local only; not exposed on a deployed app (we don't deploy).

## WebSocket protocol

```ts
// server → client
type ServerEvent =
  | { type: "job.update"; jobId: string; status: string; progress: number; error?: string }
  | { type: "render.update"; renderId: string; status: string; progress: number; videoPath?: string }
  | { type: "cost.update"; todayUsd: number; bookUsd: number }
  | { type: "hello"; serverTime: number };

// client → server
type ClientMsg =
  | { type: "subscribe"; scopes: ("global" | `chapter:${string}` | `render:${string}`)[] }
  | { type: "unsubscribe"; scopes: string[] }
  | { type: "ping" };
```

- Ping/pong every 30s; idle disconnect after 90s.
- Server broadcasts to scope subscribers only; falls back to a no-op if no listeners.
- On reconnect, client re-subscribes and the dashboard requests a one-shot `GET /api/renders?chapter=<cid>` to backfill.

## Custom server skeleton (`apps/studio/server.ts`)

```ts
import { createServer } from "node:http";
import next from "next";
import { WebSocketServer } from "ws";
import { attachHub } from "./lib/ws/hub";

const app = next({ dev: process.env.NODE_ENV !== "production" });
const handler = app.getRequestHandler();

await app.prepare();
const server = createServer((req, res) => handler(req, res));
const wss = new WebSocketServer({ server, path: "/api/ws" });
attachHub(wss);

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`studio on :${port}`));
```

This replaces `next dev` in `package.json`:

```json
"dev": "tsx watch apps/studio/server.ts"
```

The change is reversible (the bare `next dev` script is kept as `dev:next` for fallback).

## Background music

### Track library

`assets/music/` ships with 5 royalty-free loops, committed to the repo (small, MP3 at 96kbps; ~1 MB each):

| tone | track |
|---|---|
| urgent | `urgent_pulse.mp3` |
| explainer | `calm_focus.mp3` |
| payoff | `motivational_lift.mp3` |
| (neutral) | `neutral_groove.mp3` |
| (cinematic) | `cinematic_swell.mp3` |

(File names are stable; the actual tracks are chosen from a free-license library during implementation.)

### `pickTrack(beats)` (pure)

Counts tone occurrences in `Script.visualBeats`. Picks the track keyed by the modal tone. Falls back to `neutral_groove` on ties.

### Mixing

In Phase 6's render orchestrator, when `Setting("enable_music") === "true"`:

1. Pick track via `pickTrack(beats)`.
2. After Remotion writes `video.mp4`, run:
   ```bash
   ffmpeg -i video.mp4 -i <track> -filter_complex \
     "[1:a]volume=-18dB,aloop=loop=-1:size=2e9[bg];
      [0:a][bg]amix=inputs=2:duration=shortest[a]" \
     -map 0:v -map "[a]" -c:v copy -c:a aac \
     video.mixed.mp4
   ```
3. Swap `video.mixed.mp4` → `video.mp4` (atomic rename).
4. Save the track choice to `Render.musicPath` (new optional column, additive).

Schema addition:

```prisma
model Render {
  // ...existing
  musicPath String?
}
```

## Error handling summary

| Failure | Behavior |
|---|---|
| WS upgrade fails (firewall, proxy) | Client falls back to 2s polling; dashboard still works, just less smooth |
| Hub broadcasts to disconnected socket | Caught; socket removed from registry |
| Retry on a render whose audio/captions/picks were deleted | Pre-flight rejects: "missing prerequisites — re-run phase X" |
| Music track missing | Warn + skip mix; render succeeds without music |
| ffmpeg mix exit ≠ 0 | Capture stderr; preserve original video.mp4; render still marked `done` with a warning |
| Cost aggregation query > 500ms | Cached value served; log a warning |
| Logs page hits a 100 MB log file | Stream the last 100 KB only |

## Testing strategy

### Unit (TDD red → green)

- `apps/studio/lib/ws/hub.test.ts` — subscribe/unsubscribe/broadcast; scope routing; disconnect cleanup.
- `apps/studio/lib/music/pick-track.test.ts` — modal-tone selection; tie-break stability.
- `apps/studio/lib/music/mix-args.test.ts` — ffmpeg argv construction.
- `apps/studio/lib/jobs/emit.test.ts` — `emit` fires hub.broadcast with the right scope.
- `apps/studio/app/api/renders/bulk/route.test.ts` — N approved scripts → N jobs enqueued with `p-limit(renderConcurrency)`.
- `apps/studio/lib/cost/today.test.ts` — sums ApiUsage rows by service for today + book.

### Integration

- `apps/studio/lib/ws/integration.test.ts` — real WS server, simulated client: subscribe → trigger job mutation → assert client receives `job.update`.
- `apps/studio/lib/music/mix.integration.test.ts` — real ffmpeg over fixture mp4 + 5s music clip; output mp4 has audio stream with mix.

### Smoke

- `scripts/smoke/phase7-hello.ts` — starts the custom server in-process, connects a WS client, kicks off a fixture render job, asserts ≥1 `job.update` received with `progress > 0`. Local only ($0). Registered as `pnpm smoke:phase7`.

### Manual UI verification (acceptance)

- 10-script chapter → click **Render All** → dashboard shows live progress without page reload → enable music in settings, re-render one script → audible music in MP4 → kill a script's audio file and click **Retry** → friendly "missing prerequisites" error → kill the dev server mid-render → restart → orphaned job marked `failed`, **Retry** works → press `?` → shortcuts modal opens.

## Out of scope (Phase 8+)

- Auth, multi-user, deployment.
- Auto-upload to YouTube / Instagram / TikTok (per master spec out-of-MVP list).
- Character on screen + lip-sync.
- Per-platform variants (Shorts vs Reels vs TikTok cuts).
- Multi-niche / multi-channel.
- Analytics feedback loop (post-publish performance → re-scoring).
- Live Remotion Studio preview.
- WS authentication (single-user local-only; no need).
- SSE fallback (we use polling fallback instead — simpler).

## Acceptance criteria

1. ✅ **Render All** on a 10-script chapter completes 10 MP4s in 5–10 min on M3.
2. ✅ Dashboard shows per-render progress bars updating live (no client-side polling required when WS connects).
3. ✅ Killing the WS server mid-render → client transparently falls back to polling; dashboard keeps updating.
4. ✅ A failed render gets a one-click **Retry**; the retried job succeeds without redoing Phase 4 or Phase 5.
5. ✅ Enabling background music in settings → next render mixes a tonal-match track at the configured gain; original (no-music) MP4 is overwritten atomically.
6. ✅ **Open folder** reveals the bundle in Finder for every render row.
7. ✅ `?` opens a shortcuts cheatsheet; `g r` navigates to `/renders`; `r` triggers **Render All** when focused on a chapter page.
8. ✅ Header cost badge updates within 30s of a new `ApiUsage` row.
9. ✅ `/admin/logs` shows recent log lines and filters by traceId.
10. ✅ `pnpm test` green; `pnpm smoke:phase7` exits 0; `pnpm smoke:all` exits 0.
11. ✅ All work committed; `phase-7-complete` tag exists; `mvp-complete` tag exists once Phase 7 is merged.

## Definition of done — MVP (mirrors master spec §7)

> Upload a finance book PDF → review chapters → for one chapter, see scored ideas with suggestions → approve and accept suggestions → 10–15 scripts generated → b-roll picked → render all → 10–15 ready-to-upload MP4s + metadata files in `/output/<book>/<chapter>/`. End-to-end on M3, under 30 minutes per chapter.

## Open follow-ups (not blocking Phase 7)

- WS reconnection backoff tuning (currently fixed 2s).
- Cost badge breakdown drawer (per-service / per-book / per-chapter).
- "Retry all failed" bulk action on the dashboard.
- Background-music ducking under voice (sidechain compressor) for cleaner mix.
- Toast suppression rules (don't pop a toast for every progress update — only terminal states).
- Per-render musicPath shown in dashboard with a play button.
