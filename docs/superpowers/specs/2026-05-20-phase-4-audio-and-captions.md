# Phase 4 — Voice Synthesis & Word-level Captions

> Implementation phase for [[2026-05-19-faceless-content-pipeline-design]] §5.9, §5.10, and the Phase 4 milestone in §7. Depends on [[2026-05-20-phase-1-book-to-ideas-design]] (Job runner) and [[2026-05-20-phase-3-scripts-and-metadata]] (`Script` rows exist with hook/body/cta).

## Goal

For each approved script, synthesize a voice-over locally with Piper, extract per-word timing with whisper.cpp, persist the artifacts to a `Render` row, and expose an inline `<audio>` preview with a word-by-word highlight overlay.

**Phase 4 is done when:** clicking **Synthesize** on a script card produces a playable WAV + word-timing JSON in ~10s on M3; the audio preview highlights words synchronously as it plays; the chosen voice persists across restart.

## Architecture

```
┌──────────────────── apps/studio ───────────────────┐
│  /settings — voice picker (Ryan / Amy)              │
│  /books/[id]/chapters/[cid]/scripts                 │
│    ScriptCard:                                       │
│      [Synthesize] / [Regenerate audio]              │
│      <AudioPreview> with caption overlay            │
│                                                      │
│  POST   /api/scripts/[id]/synthesize                │
│  GET    /api/renders/[id]                           │
│  GET    /api/renders/[id]/audio   (streams .wav)    │
│  GET    /api/renders/[id]/captions (returns JSON)   │
│  GET    /api/settings/voice                         │
│  PATCH  /api/settings/voice                         │
└──────────────────────────┬─────────────────────────┘
                           │
                ┌──────────┼─────────────┐
                │          │             │
        ┌───────▼──┐ ┌─────▼──┐ ┌────────▼─────┐
        │ tts/     │ │captions│ │ jobs/         │
        │ piper.ts │ │whisper │ │ synthesize-   │
        │          │ │  .ts   │ │  script.ts    │
        └──────────┘ └────────┘ └───────────────┘
```

### Package boundaries (mostly already exists)

- **`packages/tts/`** (Phase 0 already implements `buildPiperArgs` + `synthesize`):
  - `synthesize(text, { modelPath, outputPath }): Promise<{ outputPath, durationMs }>`
  - Pure wrapper around `piper` subprocess.
- **`packages/captions/`** (Phase 0 already implements `parseWhisperJson` + `transcribe`):
  - `transcribe(audioPath, { modelPath, outputJsonPath }): Promise<CaptionsResult>`
  - Pure wrapper around `whisper-cpp` subprocess; emits `{ words: [{ word, start, end }] }`.
- **`apps/studio/lib/jobs/synthesize-script.ts`** — orchestrator. Pieces:
  1. Resolve `voiceModelPath` from `Setting("default_voice")`.
  2. Write script text to `output/<scriptId>/script.txt`.
  3. Call `synthesize(text, { modelPath, outputPath })`.
  4. Call `transcribe(audioPath, { modelPath, outputJsonPath })`.
  5. Compute `durationSec` (from WAV header) + `fileSizeMB` (from fs.stat).
  6. Update `Render` row + `Script.status` if appropriate.
- **`apps/studio/lib/audio/wav.ts`** — tiny utility: read 44-byte WAV header → `{ sampleRate, channels, durationSec, fileSizeMB }`. No FFmpeg dependency for this.

## Data model changes

The `Render` model exists from Phase 0 with all needed columns. Phase 4 populates `audioPath`, `captionsPath`, `durationSec`, `fileSizeMB`, plus the status transitions `queued → voice → captions → done`. `videoPath` / `metadataPath` remain `null` until Phase 6.

One new model:

```prisma
model Setting {
  key       String   @id     // "default_voice" | "render_concurrency" | ...
  value     String
  updatedAt DateTime @updatedAt
}
```

Seeded on first run with `{ key: "default_voice", value: "en_US-ryan-high" }`.

New `Job.type`: `"synthesize_script"`. `targetType="Render"`, `targetId=<renderId>`.

## User flow

### Voice settings (`/settings`)

1. Single page, minimal. Lists supported voices (hardcoded for MVP):
   - `en_US-ryan-high` — male, authoritative
   - `en_US-amy-medium` — female, clear
2. Radio group. Each option has a "▶ Sample" button that plays `/assets/voices/samples/<voice>.wav` (a 5-second pre-rendered sample committed to the repo).
3. `PATCH /api/settings/voice { value }` updates the `Setting` row. Used by all subsequent synth jobs. Existing renders are not invalidated.
4. The page also shows a small status block: per voice, "✓ model installed" or "✗ run `pnpm setup:piper`" based on file existence at `assets/voices/<voice>.onnx`.

### Synthesize from script card

1. On the script-review page (Phase 3), each card gains a **Synthesize** button. Visible when `Script.status ∈ {draft, approved}` and the script has no `Render` yet, OR an existing render is in a terminal state.
2. Click → `POST /api/scripts/[id]/synthesize`. Server:
   - Upserts a `Render` row for this script (one per script — unique constraint already in schema).
   - Creates `Job(type="synthesize_script", targetType="Render", targetId=<renderId>)`.
   - Returns `{ renderId, jobId }` (HTTP 202).
3. UI polls the job. Card replaces the button with a small progress bar labeled by stage (`voice 30% → captions 70% → done`).
4. On `done`, the card renders:
   - native `<audio controls src="/api/renders/<id>/audio">`,
   - a caption strip below: words mapped to inline spans, the active word styled `bg-primary scale-105` (transition 80 ms).
5. **Regenerate audio** button overwrites the existing render. Idempotent.

### Audio streaming

`GET /api/renders/[id]/audio` reads `Render.audioPath` and streams the file with:

- `Content-Type: audio/wav`
- `Content-Length` from `fs.stat`
- `Accept-Ranges: bytes` + Range support (so the `<audio>` element can seek). A small helper returns either the full body (no Range header) or a 206 partial. WAV files are small (<2MB for 30s) so this is mostly for correctness.

`GET /api/renders/[id]/captions` returns the JSON content of `Render.captionsPath`. Cache hint: `Cache-Control: private, max-age=60`.

### Word-highlight overlay

Client-side component `<AudioPreview audioUrl captionsUrl />`:

- Loads captions JSON on mount.
- Subscribes to the `<audio>` element's `timeupdate` event (~250 ms cadence).
- Binary-searches `words` by `currentTime` (helper `activeWordIndex(words, t)`).
- Re-renders only the changed span via React state. Stable keys = word index.
- Click on any word seeks the audio to `word.start`.

## Job orchestration internals

```
status transitions inside synthesize_script:
  queued
  → voice    (progress=5, kick off piper)
  → voice    (progress=50, piper done)
  → captions (progress=55, kick off whisper)
  → captions (progress=95, whisper done)
  → done     (progress=100, Render row finalized)
```

Concurrency: `p-limit(2)` on `synthesize_script` jobs across the app (the bottleneck is single-threaded Piper + whisper; two-up is the sweet spot on M3).

### Voice file resolution

```ts
function resolveVoiceModel(): string {
  const v = getSetting("default_voice"); // "en_US-ryan-high"
  const p = path.resolve("assets/voices", `${v}.onnx`);
  if (!fs.existsSync(p)) {
    throw new VoiceModelMissingError(v, p);
  }
  return p;
}
```

`VoiceModelMissingError` carries an actionable message: `"Voice model en_US-ryan-high not found. Run pnpm setup:piper to install it."` This is surfaced as `Render.error` and shown in the UI directly (no stack trace).

### WAV header reader (`apps/studio/lib/audio/wav.ts`)

Reads first 44 bytes (RIFF WAVE header), extracts:

```ts
type WavHeader = {
  sampleRate: number;      // bytes 24-27 (little-endian uint32)
  channels: number;        // bytes 22-23 (uint16)
  dataBytes: number;       // bytes 40-43 (uint32)
  durationSec: number;     // dataBytes / (sampleRate * channels * 2)  for 16-bit PCM
};
```

This avoids depending on ffprobe for the simple case. Piper writes standard 16-bit mono WAV; we assume that and assert.

### Script text composition

```ts
const text = [script.hook, script.body, script.cta]
  .map(s => s.trim())
  .filter(Boolean)
  .join(". ")  // forces sentence boundaries between sections
  .replace(/\.\s*\./g, ".");  // de-dup trailing periods
```

Piper handles SSML poorly across versions; plain text is safest. Future SSML support is an open follow-up.

## Error handling summary

| Failure | Behavior |
|---|---|
| Voice model file missing | Fail job with `VoiceModelMissingError`; `Render.error` set; UI shows actionable message |
| Piper subprocess exit ≠ 0 | Capture stderr → `Render.error` → status=`failed` |
| Piper output WAV < 5 KB | Treat as failure ("piper produced empty audio") |
| whisper-cpp model missing | Same actionable error pattern → "run `pnpm setup:whisper`" |
| whisper-cpp subprocess exit ≠ 0 | Capture stderr; status=`failed` |
| whisper produces 0 words | Fall back to evenly-distributed timing (1 word per `durationSec / wordCount`) and set `Render.warning = "captions estimated"` |
| Disk < 1 GB free at job start | Pre-flight check; refuse with `Render.error="disk_low"` |
| HMR / process restart with running synth job | Reuse Phase 1 orphan recovery: `failed`, error="interrupted" |
| Audio stream Range header out of bounds | 416 Range Not Satisfiable |
| Captions JSON missing on disk but Render.status=done | Treat as orphaned; 410 Gone; UI surfaces "regenerate" |

## Testing strategy

### Unit (TDD red → green)

- `packages/tts/src/piper.test.ts` — `buildPiperArgs` (already exists, Phase 0). No changes.
- `packages/captions/src/whisper.test.ts` — `parseWhisperJson` (already exists, Phase 0). No changes.
- `apps/studio/lib/audio/wav.test.ts` — reads a committed 1KB stub WAV with known header; assert sampleRate + channels + durationSec.
- `apps/studio/lib/audio/active-word.test.ts` — `activeWordIndex(words, t)`:
  - empty array → `-1`,
  - t before first word → `-1`,
  - t past last word → last index,
  - boundary at `word.end` → that word's index (inclusive),
  - 1000-word stress → < 1 ms via binary search.
- `apps/studio/lib/jobs/synthesize-script.test.ts` — orchestrator with mocked `synthesize` and `transcribe`:
  - happy path writes Render fields + status transitions monotonically,
  - voice-missing throws VoiceModelMissingError → status=failed with actionable error,
  - whisper-zero-words falls back to even distribution and sets warning,
  - re-running overwrites prior audioPath/captionsPath.
- `apps/studio/app/api/renders/[id]/audio/route.test.ts` — Range header handling: full body, valid range, out-of-range → 416.

### Integration

- `apps/studio/lib/jobs/synthesize-script.integration.test.ts` — uses a **stub Piper** (a tiny shell script that writes a static fixture WAV) and a **stub whisper-cpp** (writes a static fixture JSON) on `PATH`. Verifies the orchestrator wires real subprocesses end-to-end. No DB mocking.

### Smoke

- `scripts/smoke/phase4-hello.ts` — **real** Piper + **real** whisper.cpp on a 30-word fixture script. Asserts `output/_smoke/audio.wav > 20 KB` and `≥ 25 words` in caption JSON within 15s wall-clock. Registered as `pnpm smoke:phase4`. Costs $0 (all local). **Added to `smoke:all`** since it requires only local binaries.

### Manual UI verification (acceptance)

- Visit `/settings`, switch voice to Amy, play sample (should sound female).
- On a script card from Phase 3, click Synthesize. Audio + caption strip appears in ~10s on M3.
- Play audio: each word highlights as it's spoken (≤100 ms visual lag).
- Click a word in the strip: audio seeks to that point.

## Out of scope (Phase 5+)

- B-roll picker (Phase 5).
- Remotion render (Phase 6).
- Render queue dashboard with WebSockets (Phase 7).
- Background-music mixing.
- Per-script voice override (settings-level only for MVP).
- Voice cloning (e.g., XTTS, ElevenLabs).
- SSML / prosody markup; pause-on-period tuning.
- Multi-language voices.

## Acceptance criteria

1. ✅ `/settings` lets the user switch voice; selection persists across `pnpm dev` restart.
2. ✅ Voice sample plays when "▶ Sample" is clicked.
3. ✅ Synthesize on a 30s-target script completes in ~10s on M3.
4. ✅ Resulting `<audio>` plays the voiceover; word-highlight strip syncs within ≤100 ms of audio playback.
5. ✅ Click a word in the strip → audio seeks to that timestamp.
6. ✅ Re-synthesize overwrites prior outputs; no orphan files in `output/<scriptId>/`.
7. ✅ Deleting a voice model and clicking Synthesize → friendly actionable error ("run `pnpm setup:piper`"), not a stack trace.
8. ✅ `pnpm test` green; `pnpm smoke:phase4` exits 0; `pnpm smoke:all` still exits 0 (with Phase 4 included).
9. ✅ All work committed; `phase-4-complete` tag exists.

## Open follow-ups (not blocking Phase 4)

- Per-script voice override (overrides global default for a given script).
- Voice speed slider (Piper supports `--length-scale`).
- SSML emission with pause-on-period heuristic for more natural pacing.
- "Auto-synth on script approve" — wire `Idea.status="scripted"` to trigger synthesize_script automatically (currently manual).
- Streamed playback while Piper is still writing (progressive WAV header trick) — only worthwhile if perceived latency becomes a complaint.
- A debug `/renders` page listing every render with stage timings.
