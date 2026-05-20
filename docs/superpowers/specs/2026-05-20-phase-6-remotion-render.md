# Phase 6 — Remotion Render & Output Bundle

> Implementation phase for [[2026-05-19-faceless-content-pipeline-design]] §6 (Remotion composition) and the Phase 6 milestone in §7. Depends on [[2026-05-20-phase-3-scripts-and-metadata]] (`Script.visualBeats`, metadata), [[2026-05-20-phase-4-audio-and-captions]] (`Render.audioPath`, `Render.captionsPath`), and [[2026-05-20-phase-5-broll-picker]] (`Asset` rows with `pickedAssetId` per beat).

## Goal

Compose voice + word-timed captions + picked b-roll + theme tokens + chart overlays into a 1080×1920 H.264 MP4 via the Remotion CLI. Produce a re-renderable output bundle alongside the MP4.

**Phase 6 is done when:** clicking **Render** on a script that has audio, captions, and a picked asset per beat produces a playable 1080×1920 MP4 in 30–60s on M3, with synced word captions, ken-burns on photos, chart reveals on data beats, and a complete `output/<book>/<chapter>/<script>/` bundle.

## Architecture

```
┌──────────────────── apps/studio ───────────────────┐
│  /books/[id]/chapters/[cid]/scripts                 │
│    ScriptCard:                                       │
│      [Render] button (gated by audio + all picks)   │
│      <video> preview when render.videoPath exists   │
│      [Open folder] reveals bundle in Finder         │
│                                                      │
│  POST  /api/scripts/[id]/render                     │
│  GET   /api/renders/[id]/video    (streams .mp4)    │
│  POST  /api/renders/[id]/rerender (uses saved JSON) │
└──────────────────────────┬──────────────────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────▼─────┐ ┌────▼────┐ ┌─────▼───────┐
        │ jobs/     │ │ db      │ │ packages/   │
        │  render-  │ │         │ │  remotion/  │
        │  script.ts│ │         │ │  (React)    │
        └───────────┘ └─────────┘ └─────────────┘
                           │
                    spawn: npx remotion render
                           │
                ┌──────────▼─────────┐
                │ output/.../video.mp4│
                └─────────────────────┘
```

### Package boundaries

**Critical:** Remotion is invoked via its CLI with a JSON props file. It never imports from `apps/studio` or touches Prisma. Clean process boundary makes re-renders trivial.

- **`packages/remotion/`** — pure React composition.
  - `src/index.ts` — `registerRoot(RemotionRoot)`.
  - `src/Root.tsx` — `<Composition id="Video">` declaration.
  - `src/Video.tsx` — orchestrates HookScene / BeatScene / ChartScene / CtaScene by frame range.
  - `src/scenes/` — one file per scene type.
  - `src/components/` — `KineticCaption`, `BRollImage`, `BRollVideo`, `SlideUpCard`, `ChartReveal`.
  - `src/theme/{tokens.ts,finance.ts}` — theme tokens.
  - `src/data/types.ts` — exported `RenderInput`, `ChartSpec` types.
- **`apps/studio/lib/jobs/render-script.ts`** — orchestrator.
  1. `buildRenderInput(scriptId)` — pure (test surface).
  2. Download full Pexels assets that have only thumbs cached (lazy, via Phase 5's `downloadAsset`).
  3. Write `render-input.json` to `output/<scriptId>/render-input.json`.
  4. Spawn `npx remotion render`; capture stderr; await exit.
  5. Probe MP4 (ffprobe) for resolution + duration; verify ≥ 100 KB.
  6. Generate thumbnail (ffmpeg, frame at t=1s).
  7. Write `metadata.txt`; copy debug artifacts.
  8. Update `Render` row.
- **`apps/studio/lib/probe/ffprobe.ts`** — small wrapper, parses JSON output.
- **`apps/studio/lib/probe/thumbnail.ts`** — ffmpeg single-frame extraction.

## Data model changes

The `Render` model exists from Phase 0; Phase 6 populates `videoPath`, `metadataPath`, `durationSec` (re-derived from MP4), `fileSizeMB`, plus status transitions `done` (from Phase 4's "audio done" → `render` → `bundle` → `done`).

No new tables.

`Script.visualBeats[i]` will be read with `pickedAssetId` (set in Phase 5). The render job resolves that to a local `Asset.localPath`.

New `Job.type`: `"render_script"`.

App-wide concurrency cap: `Setting("render_concurrency")` (default 2). `p-limit(renderConcurrency)` on `render_script` jobs.

## User flow

### Render gate

A script's **Render** button is enabled only when:

- `Render.audioPath` exists (Phase 4 done),
- `Render.captionsPath` exists (Phase 4 done),
- every `Script.visualBeats[i].pickedAssetId` is non-null (Phase 5 done),
- no `render_script` job is currently running for this script.

If any condition is missing, the button is greyed with a tooltip listing what's needed.

### Render flow

1. Click **Render** → `POST /api/scripts/[id]/render` → `Job(type="render_script", targetType="Render", targetId=<renderId>)`. Returns 202.
2. Job stages, all writing `Render.progress`:
   ```
   0  → 5:    buildRenderInput + write render-input.json
   5  → 25:   download missing full assets (per beat, p-limit 4)
   25 → 90:   spawn remotion render (status="render")
   90 → 95:   ffprobe + generate thumbnail (status="bundle")
   95 → 100:  write metadata.txt + finalize Render row
   ```
3. UI polls. Card swaps the **Render** button for a `<video controls src="/api/renders/<id>/video">` preview + an **Open folder** button.

### Open folder

`POST /api/renders/[id]/reveal` → server spawns `open <bundleDir>` on macOS (Finder reveal). Returns 204. No UI side effect beyond the OS action.

### Re-render

`POST /api/renders/[id]/rerender` — uses the saved `output/<scriptId>/render-input.json`. Skips Claude/Piper/whisper entirely. Useful for:

- swapping a single picked asset (UI updates `pickedAssetId`, then user clicks **Re-render**),
- swapping `theme` (dark → light, currently dark-only).

## `RenderInput` contract (`packages/remotion/src/data/types.ts`)

```ts
export type ChartSpec = {
  kind: "bar" | "line" | "stat";
  label: string;
  data?: number[];
  bigNumber?: string;
};

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
    assetPath: string;            // absolute path, resolved by buildRenderInput
    assetType: "photo" | "video";
    chart?: ChartSpec;
  }[];
  theme: "finance-dark" | "finance-light";
  metadata: {
    youtubeTitle: string;
    caption: string;
    hashtags: string[];
    thumbnailConcept: string;
  };
};
```

### `buildRenderInput(scriptId)` (pure)

Reads from DB:

- `Script` (hook/body/cta/visualBeats/metadata),
- `Render` (audioPath/captionsPath),
- `Asset` rows for each beat's `pickedAssetId`.

Returns the populated `RenderInput`. Paths in the JSON are **absolute** so the CLI can locate them regardless of cwd.

`durationFrames = round(captions.lastWordEnd × 30)`; clamped to `max(audio.durationSec, lastBeatEnd) × 30` for safety.

## Composition (`packages/remotion/src/`)

### `Root.tsx`

```tsx
import { Composition } from "remotion";
import { Video } from "./Video";

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Video"
    component={Video}
    durationInFrames={1800}   // overridden at render time by --props
    fps={30}
    width={1080}
    height={1920}
    defaultProps={{ /* a fixture for the preview UI */ }}
  />
);
```

### `Video.tsx`

Reads `RenderInput` from `useProps()`. Renders the audio track, then for each beat picks a scene:

- `chart` set → `<ChartScene>`,
- `assetType === "photo"` → `<BeatScene asset={BRollImage} />`,
- `assetType === "video"` → `<BeatScene asset={BRollVideo} />`.

Wraps the first 3 seconds in `<HookScene>` (larger hook text overlay) and the last 2 seconds in `<CtaScene>` (CTA overlay + thumbnail-concept tease).

The `<KineticCaption>` component renders word-by-word over the whole timeline using the captions array.

### Animation primitives (per master spec §6.4)

- **Ken-burns on photos** (`BRollImage`): scale `1.0 → 1.08` over the beat duration via `interpolate(frame, [0, dur], [1.0, 1.08])`.
- **Slide-up cards** (`SlideUpCard`): `spring()` entrance, `translateY: 100% → 0%`. `damping: 100`, `stiffness: 200`.
- **Word-by-word caption highlight** (`KineticCaption`): current word colored `theme.textHighlight` + `scale 1.0 → 1.1` via interpolate over a 4-frame window centered on the word's start frame.
- **Chart bar grow** (`ChartReveal` bar variant): `interpolate` 0% → target%, `Easing.bezier(0.16, 1, 0.3, 1)` over 18 frames.
- **Beat transitions:** 4-frame cross-fade between adjacent scenes via `interpolate(frame, [end-4, end], [1, 0])`.

### Theme (`theme/finance.ts`)

```ts
export const financeDark = {
  bg: "#0B0F1A",
  textPrimary: "#FFFFFF",
  textHighlight: "#00FF85",
  accent: "#FFD700",
  font: "Inter",
  captionSize: 96,
  captionStroke: 8,
  captionPosition: "bottom-third",
  bRollKenBurns: { from: 1.0, to: 1.08, durationSec: 4 },
  enterEasing: "easeOutBack",
} as const;
```

`finance-light` is stubbed but not used in Phase 6 acceptance.

### Charts (all React + SVG, no chart libs)

- **`stat`** — one centered `<text>` with `bigNumber` + a smaller `<text>` with `label`. Reveal: opacity 0 → 1 + scale 0.9 → 1.0 over 12 frames.
- **`bar`** — 2–4 vertical `<rect>` elements with animated `height`. Labels below. Reveal staggered by 6 frames.
- **`line`** — a single SVG `<path>` whose `strokeDasharray` is animated 0 → totalLength (the canonical SVG line-draw trick).

## Render invocation

```bash
npx remotion render \
  packages/remotion/src/index.ts \
  Video \
  /abs/output/<scriptId>/video.mp4 \
  --props=/abs/output/<scriptId>/render-input.json \
  --concurrency=4 \
  --x264-preset=fast
```

Notes:

- `--concurrency=4` is Remotion's per-render parallel-frame setting (uses the 40-core GPU). App-wide cap is separate (`render_concurrency`, default 2).
- `--x264-preset=fast` keeps file sizes reasonable for the M3 (~3–5 MB for 30s).
- `--gl=angle` is set via env (`REMOTION_GL=angle`) on macOS for stability.
- stderr is captured to `Render.error` when exit code ≠ 0.

## Output bundle (per master spec §6.8)

After the MP4 is verified, the job writes the bundle:

```
output/<book-slug>/<chapter-slug>/<script-id>/
├── video.mp4              # 1080×1920 H.264
├── thumbnail.jpg          # frame at t=1s, 1080×1920
├── metadata.txt           # title, caption, hashtags, thumbnail concept, score
└── debug/
    ├── audio.wav          # copied / symlinked
    ├── captions.json      # copied
    ├── render-input.json  # the exact props used → enables re-render
    └── score.json         # { score, breakdown, reasoning }
```

`metadata.txt` format matches the master spec §6.8 exactly (re-printed here for clarity):

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

Path slugs are `kebab-case(title)` truncated to 40 chars, with `cuid()` suffix on collision.

## Error handling summary

| Failure | Behavior |
|---|---|
| Missing audio (Render.audioPath null) | UI button disabled with tooltip; if API hit anyway → 409 |
| Missing pick for any beat | Same — 409 |
| Missing full asset on disk (only thumb cached) | Job downloads it (Phase 5 helper); fails actionable if Pexels URL gone |
| Remotion subprocess exit ≠ 0 | Stderr → `Render.error`; status=failed; `render-input.json` preserved |
| MP4 < 100 KB | Treat as failed ("remotion produced empty mp4") |
| ffprobe exit ≠ 0 | Skip duration probe; trust frame count; warn |
| Disk < 2 GB free at job start | Refuse; `Render.error="disk_low"` |
| HMR / process restart with running render | Phase 1 orphan recovery: failed, error="interrupted" |
| Thumbnail extraction fails | Warn-only; bundle written without `thumbnail.jpg` |

## Testing strategy

### Unit (TDD red → green)

- `apps/studio/lib/render/build-input.test.ts` — `buildRenderInput`:
  - 3-beat fixture (1 photo, 1 video, 1 chart) → expected JSON shape,
  - `durationFrames` rounds correctly,
  - asset paths absolute,
  - throws when a beat lacks `pickedAssetId`.
- `packages/remotion/src/components/KineticCaption.test.tsx` — react-testing-library + Remotion's mock frame; at frame `k` only the right word is highlighted; boundary cases at word.start/word.end.
- `packages/remotion/src/components/ChartReveal.test.tsx` — renders `<text bigNumber>` for stat, N `<rect>` for bar, one `<path>` for line.
- `apps/studio/lib/probe/ffprobe.test.ts` — mocked subprocess: parses JSON and resolution.
- `apps/studio/lib/probe/thumbnail.test.ts` — verifies ffmpeg args.
- `apps/studio/lib/jobs/render-script.test.ts` — orchestrator with mocked spawn + mocked DB: happy path; Remotion non-zero → failed; MP4 < 100 KB → failed.

### Integration

- `apps/studio/lib/jobs/render-script.integration.test.ts` — uses a **real Remotion** render of a tiny 2-second composition with a fixture audio + 1 beat. Asserts `output/<scriptId>/video.mp4` exists, > 50 KB, 1080×1920 via ffprobe. Marked `slow`.

### Smoke

- `scripts/smoke/phase6-hello.ts` — full pipeline against committed fixtures: known audio + captions + thumbnail asset → render → ffprobe asserts 1080×1920 H.264, duration ≈ 2s. Registered as `pnpm smoke:phase6`. Local only ($0). **Not** in `smoke:all` (slow ~30s).

### Manual UI verification (acceptance)

- Pick a Phase 5–ready script. Click Render. After 30–60s, `<video>` plays. Captions sync with audio. Photo beats show ken-burns. Chart beats reveal. CTA appears at the end. Open the output folder; `metadata.txt` is readable.

## Out of scope (Phase 7+)

- Live render-queue dashboard with WebSocket updates (Phase 7).
- Background music mixing (Phase 7).
- Multiple themes / niche-scoped templates beyond `finance-dark`.
- Animated text transitions beyond word-highlight + slide-up.
- Particle/3D effects.
- Per-platform variants (YouTube vs TikTok cuts).
- Live preview in Remotion Studio (dev experience nicety).

## Acceptance criteria

1. ✅ Render button is correctly gated (disabled when audio/captions/picks missing).
2. ✅ Render completes in 30–60s for a 30s script on M3.
3. ✅ MP4 is exactly 1080×1920, H.264, with audio track.
4. ✅ Word captions sync within ±100 ms of audio.
5. ✅ Photo beats show ken-burns 1.0→1.08 over the beat duration.
6. ✅ Chart beats render the expected `stat`/`bar`/`line` variant.
7. ✅ Output bundle complete: `video.mp4`, `thumbnail.jpg`, `metadata.txt`, `debug/render-input.json`.
8. ✅ Open folder reveals the bundle in Finder.
9. ✅ Re-render from saved `render-input.json` reproduces a byte-similar MP4 (modulo encoder nondeterminism — duration + resolution + size within 1%).
10. ✅ `pnpm test` green; `pnpm smoke:phase6` exits 0.
11. ✅ All work committed; `phase-6-complete` tag exists.

## Open follow-ups (not blocking Phase 6)

- `finance-light` theme variant + UI picker.
- Animated transitions tuned per beat tone (`urgent` snappier, `payoff` slower).
- Per-platform crop variants (1:1 thumbnail, 16:9 export).
- Live Remotion Studio preview launched from the script card.
- Captioning style preset (TikTok-bold vs YouTube-clean).
