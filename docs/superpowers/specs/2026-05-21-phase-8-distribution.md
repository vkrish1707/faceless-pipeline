# Phase 8 — Distribution & Publishing

> Implementation phase for the post-MVP layer of [[2026-05-19-faceless-content-pipeline-design]] §"Out of MVP scope" — distribution. Depends on every prior phase, especially [[2026-05-20-phase-6-remotion-render]] (`Render.videoPath` and the output bundle exist) and [[2026-05-20-phase-7-render-queue-polish.md]] (`/renders` dashboard, custom server, settings infra).

## Goal

Take a finished Render bundle (MP4 + metadata.txt + thumbnail.jpg) and publish it to YouTube Shorts, TikTok, and Instagram Reels via their official APIs. Support per-platform metadata variants, OAuth-connected channels, draft / scheduled / publish modes, and a `/publications` view that tracks every upload attempt with retry.

**Phase 8 is done when:** a user can connect one or more channels (YT/TT/IG) in `/channels`, click **Publish** on any rendered script card, choose target platforms + privacy + schedule, and see the result land — within a minute for direct publish, or at the scheduled time for queued. Failed uploads can be retried in one click and surface the platform error verbatim.

## Architecture

```
┌───────────────────── apps/studio ──────────────────────────┐
│  /channels       — connect / disconnect channels (OAuth)    │
│  /publications   — history view, filter by platform/status  │
│  /books/[id]/chapters/[cid]/scripts                          │
│    ScriptCard:                                                │
│      [Publish ▾] — opens per-script publish modal            │
│  /renders                                                     │
│    row action: [Publish] (same modal)                        │
│                                                               │
│  GET   /api/channels                                          │
│  GET   /api/channels/oauth/[provider]/start                  │
│  GET   /api/channels/oauth/[provider]/callback               │
│  DELETE /api/channels/[id]                                    │
│                                                               │
│  POST  /api/scripts/[id]/publish                             │
│  GET   /api/publications                                     │
│  GET   /api/publications/[id]                                │
│  POST  /api/publications/[id]/retry                          │
│  POST  /api/publications/[id]/cancel                         │
└─────────────────────────┬──────────────────────────────────┘
                          │
              ┌───────────┼────────────┐
              │           │            │
        ┌─────▼─────┐ ┌───▼───┐ ┌──────▼──────────┐
        │ packages/ │ │ db    │ │ jobs/            │
        │ publish/  │ │       │ │  publish-video.ts│
        │  youtube  │ │       │ │  (per-platform)  │
        │  tiktok   │ │       │ │                  │
        │  instagram│ │       │ │                  │
        │  oauth/   │ │       │ │                  │
        └───────────┘ └───────┘ └──────────────────┘
                          │
                  ┌───────▼────────┐
                  │ encrypted      │
                  │ OAuth tokens   │
                  │ at rest        │
                  └────────────────┘
```

### Package boundaries

- **`packages/publish/`** — new package; pure platform clients. No DB writes.
  - `src/youtube.ts` — `uploadShort({ filePath, metadata, privacy, accessToken })` — uses `googleapis` resumable upload. Returns `{ videoId, url, publishedAt }`.
  - `src/tiktok.ts` — `uploadVideo({ filePath, metadata, accessToken })` — uses TikTok Content Posting API v2. Returns `{ shareId, url, status: "PROCESSING_UPLOAD" }` plus a `pollStatus(shareId)` helper because TikTok finalizes asynchronously.
  - `src/instagram.ts` — `uploadReel({ filePath, caption, hashtags, accessToken, igUserId })` — uses Meta Graph API container + publish two-step flow.
  - `src/oauth/{youtube,tiktok,instagram}.ts` — `buildAuthUrl(state)`, `exchangeCode(code)`, `refreshToken(refreshToken)`.
  - `src/index.ts` — re-exports + a unified `Platform = "youtube" | "tiktok" | "instagram"` enum.
- **`apps/studio/lib/crypto/secret.ts`** — `encryptSecret(plaintext, key)` / `decryptSecret(ciphertext, key)` using Node `crypto.createCipheriv` with AES-256-GCM. Key comes from `process.env.STUDIO_SECRET_KEY` (32-byte base64). On first run, if absent, the app generates one into `.env.local` with a warning.
- **`apps/studio/lib/jobs/handlers/publish-video.ts`** — DI orchestrator. Resolves channel + Render, refreshes token if expired, calls the right platform client, captures result, updates Publication row, schedules a follow-up status-poll job for TikTok (which finalizes async).
- **`apps/studio/lib/publish/metadata.ts`** — pure helpers that derive per-platform metadata from `Script.metadata`:
  - YouTube: title (≤100), description (caption + linkified hashtags), tags (hashtags without `#`), `madeForKids: false`, `categoryId: "27"` (Education).
  - TikTok: caption (text + hashtags, ≤2200), privacy.
  - Instagram: caption (text + hashtags inline, ≤2200), thumbnail.

## Data model additions

```prisma
model Channel {
  id            String   @id @default(cuid())
  provider      String   // "youtube" | "tiktok" | "instagram"
  displayName   String   // YouTube channel name, TikTok @handle, IG @handle
  externalId    String   // YT channelId, TT openId, IG userId
  // Encrypted OAuth tokens — never log; never expose via JSON.
  accessTokenEnc  String
  refreshTokenEnc String?
  tokenExpiresAt  DateTime?
  scopes          String   // space-separated
  connectedAt   DateTime @default(now())
  lastUsedAt    DateTime?
  publications  Publication[]

  @@unique([provider, externalId])
}

model Publication {
  id           String   @id @default(cuid())
  scriptId     String
  script       Script   @relation(fields: [scriptId], references: [id])
  renderId     String?  // the Render whose videoPath was used
  channelId    String
  channel      Channel  @relation(fields: [channelId], references: [id])

  platform     String   // duplicated from channel.provider for indexing
  status       String   // "queued" | "uploading" | "processing" | "scheduled" | "published" | "failed" | "removed"
  privacy      String   // "private" | "unlisted" | "public"
  scheduledFor DateTime?

  // Per-platform fields populated as the upload progresses.
  externalId   String?  // YT videoId, TT shareId, IG mediaId
  externalUrl  String?  // canonical URL
  publishedAt  DateTime?

  // Platform-rendered metadata snapshot (so we can replay exactly).
  metadata     Json     // { title, description, tags[], thumbnailPath?, caption?, hashtags[] }

  error        String?  // last platform error verbatim
  attempts     Int      @default(0)

  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([scriptId])
  @@index([channelId, status])
  @@index([scheduledFor]) // for the scheduler tick
}
```

`Script` gets a back-relation `publications Publication[]` (additive, no SQL change).

New `Job.type` values: `"publish_video"` and `"poll_publication"` (the latter for TikTok's async processing tail).

New `Setting` keys (lazy, no schema change):
- `youtube_default_privacy` — `"private" | "unlisted" | "public"` (default `"unlisted"` for safety).
- `tiktok_default_privacy` — same.
- `instagram_default_privacy` — same.
- `publication_retention_days` — int string, default `"90"`. Older `failed` Publications are auto-purged.

## OAuth flow

### Provider config (env-only, never committed)

```
# .env.local
STUDIO_SECRET_KEY=<base64 of 32 random bytes>      # token encryption key

YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...
YOUTUBE_REDIRECT_URI=http://localhost:3000/api/channels/oauth/youtube/callback

TIKTOK_CLIENT_KEY=...
TIKTOK_CLIENT_SECRET=...
TIKTOK_REDIRECT_URI=http://localhost:3000/api/channels/oauth/tiktok/callback

# Instagram uses Facebook Login + Pages permissions; requires a Business IG acct.
META_APP_ID=...
META_APP_SECRET=...
META_REDIRECT_URI=http://localhost:3000/api/channels/oauth/instagram/callback
```

The `/channels` page surfaces a per-provider status pill: ✓ configured / ✗ missing env var. Missing env doesn't break the app; it just disables the **Connect** button with a tooltip pointing to the docs.

### Flow

1. User on `/channels` clicks **Connect YouTube**.
2. `GET /api/channels/oauth/youtube/start` → server generates a `state` (10 bytes hex, stored in a 5-min in-memory `OAuthState` map with expiry), builds the consent URL via `packages/publish/oauth/youtube.buildAuthUrl(state)`, redirects.
3. User consents → Google redirects to `/api/channels/oauth/youtube/callback?code=...&state=...`.
4. Server validates `state`, exchanges `code` for tokens via `exchangeCode`, fetches the user's channel metadata (`displayName`, `externalId`) via the YT API, encrypts tokens, upserts a `Channel` row (unique on `(provider, externalId)` — re-consent updates tokens).
5. Redirect to `/channels?connected=youtube`.

Disconnect: `DELETE /api/channels/[id]` removes the row. The platform still has any granted scopes; user can revoke server-side per platform docs. UI surfaces a "revoke at <provider URL>" link.

### Token refresh

On every publish-video job:
1. Load Channel; check `tokenExpiresAt`.
2. If <60s away, call `oauth.<provider>.refreshToken(refreshTokenEnc → decrypt)`.
3. Re-encrypt + upsert. Mark `Channel.lastUsedAt = now()`.
4. Use the fresh `accessToken` for the upload.

If refresh fails (revoked, scope removed), mark Publication `failed` with `error="reauthorize:youtube"` so the UI can prompt re-connect.

## User flow

### `/channels` page

- One section per provider with status icon + connected channel list + Connect button.
- Each connected channel shows: `@displayName`, `connectedAt`, `lastUsedAt`, **Test** button (calls the platform's lightweight `me` endpoint), **Disconnect** button.

### Publish modal (per-script)

Triggered from:
- `ScriptCard` (`/scripts` page) — only when `Render.status === "done"` and `videoPath` exists.
- `/renders` dashboard row action.

Modal contents:
- **Channels** checkboxes — one per connected channel, grouped by platform. At least one required.
- **Title / caption** — pre-filled from `Script.metadata.youtubeTitle` / `Script.metadata.caption`. Editable. Per-platform character counters.
- **Hashtags** — pre-filled from `Script.metadata.hashtags`. Editable as a space-separated chip input.
- **Thumbnail** — radio: `Use bundle thumbnail` (default, from `output/.../thumbnail.jpg`) or `Upload custom` (multipart). YT only.
- **Privacy** — radio per platform; default reads from `Setting("<provider>_default_privacy")`.
- **Schedule** — radio: `Publish now` or `Publish at <datetime>`. Date input ≥ now + 15min. (YouTube supports native scheduling; TikTok does not — for TT we hold the upload until the scheduled time, then trigger it.)
- **Submit** → `POST /api/scripts/[id]/publish` with `{ channelIds, perPlatform: {...}, scheduledFor?: ISO }`.

Server:
- Validates channels are connected and belong to the user (single-user app — trivial).
- Creates one `Publication` per channel selected, status=`queued` (or `scheduled` if `scheduledFor` future).
- Enqueues one `publish_video` job per Publication.
- Returns `{ publicationIds, jobIds }` 202.

UI navigates to `/publications?script=<id>` and dashboard-style live-updates each row via the existing Phase 7 WS hub (`emitPublication({ publicationId, status, error? })`).

### `/publications` page

- Table sortable by `createdAt` desc by default. Filters: platform, status, channel, script.
- Each row: thumbnail, script title, platform icon, channel @handle, status pill, `externalUrl` link (when published), createdAt / publishedAt.
- Actions: **Retry** (failed only), **Cancel** (queued / scheduled only), **Open on platform** (published).

### Render-side affordance

- Add a small **published-to** badge under each script card in `/scripts` when at least one Publication exists in `published` status. Click → `/publications?script=<id>`.

## Job orchestration internals

### `publish_video` handler stages

```
0  → 5:    sanity (file exists, channel still connected, token valid; refresh if needed)
5  → 15:   resize/transcode if needed
           — YT and TT both prefer 1080×1920 / H.264 / aac, which matches Phase 6 output.
           — Skip step entirely when source already matches. (no ffmpeg cost)
15 → 90:   platform upload
           — YouTube: resumable upload session, chunked PUTs with retry on 5xx
           — TikTok: single POST + poll loop
           — Instagram: create-container POST → poll `status_code` → publish POST
90 → 100:  persist Publication { externalId, externalUrl, publishedAt, status="published" }
```

App-wide concurrency: `p-limit(getPublishConcurrency())` (new Setting, default 2). Same wrapper pattern as Phase 7's `render_concurrency`.

### TikTok async tail

TikTok returns immediately with `shareId` but finalization is async (videos go through their content-review pipeline). The publish handler enqueues a `poll_publication` job with `{ publicationId }` that:
- Polls `pollStatus(shareId)` every 30s for up to 30 min.
- On terminal state, updates Publication `status` and `externalUrl`.
- Emits to WS hub so the `/publications` page live-updates.

### Scheduler

A lightweight in-process tick runs every 60s (only active when the custom server is running — Phase 7's `apps/studio/server.ts` is the host). It:
- Selects `Publication` rows where `status="scheduled"` and `scheduledFor <= now()`.
- Sets each to `status="queued"` and enqueues a `publish_video` job.
- Logs how many it released per tick.

Not durable across process restart by design — orphans (status="queued" but no running job) are caught by the existing Phase 1 orphan recovery on startup; they re-enqueue automatically.

## Per-platform notes

### YouTube Shorts

- SDK: `googleapis` v140+.
- Upload endpoint: `youtube.videos.insert` with `media.body: createReadStream`. Resumable defaults to chunked 8MB.
- Required parts: `snippet`, `status`. For Shorts auto-detection: title/description should include `#Shorts`, but ratio + duration ≤60s already qualifies. We include `#Shorts` in description for safety.
- Privacy: `private | unlisted | public`. Schedule via `status.publishAt` (ISO 8601, requires `private`).
- Quota: 1600 units per video upload. Daily quota is 10k by default; one user with their own GCP project gets enough headroom for ~6 uploads/day. Surface remaining quota best-effort via `youtubeAnalytics.reports` (cached 5min).
- Errors we surface: `quotaExceeded`, `videoChunkTooBig`, `forbidden` (when channel monetization restricts), `invalidVideo` (file format), `authentication`. Anything else → generic "platform error: <body slice>".

### TikTok

- API: Content Posting API v2 (`/v2/post/publish/video/init/` + status polling).
- File size cap: 4 GB. Phase 6 renders are well under (typically <10 MB).
- Privacy: `PUBLIC_TO_EVERYONE | MUTUAL_FOLLOW_FRIENDS | SELF_ONLY`. The TT API requires the user be an approved developer with content-posting scope; the app surfaces a clear error if the scope is missing.
- Async finalization → poll job pattern above.

### Instagram Reels

- API: Meta Graph API v18+. Requires a Business or Creator IG account linked to a Facebook Page.
- Two-step: `POST /<igUserId>/media { media_type: REELS, video_url, caption }` returns `creationId` → poll `/<creationId>?fields=status_code` until `FINISHED` → `POST /<igUserId>/media_publish { creation_id }`.
- `video_url` must be publicly reachable. Local-only studio has no public host; the publish handler temporarily uploads the MP4 to a presigned bucket (S3 or Cloudflare R2) and tears down after publish, OR (default for MVP-of-MVP) requires the user to ship a tunneling tool like `cloudflared` and surfaces a clear error otherwise.
- Hashtags must be in the caption; no separate field.

### File size + format normalization

A small `lib/publish/normalize.ts` checks the source MP4 with `ffprobe` (reused from Phase 6) and runs an `ffmpeg -c:v libx264 -preset fast -c:a aac` re-encode only if any of these are off-spec:
- container ≠ mp4
- video codec ≠ h264
- audio codec ≠ aac
- height < 720 or width × height > 4 K
- max bitrate > 12 Mbps (TikTok cap)

This step is skipped for Phase 6 output which is already compliant; the check costs ~50 ms via ffprobe.

## Error handling summary

| Failure | Behavior |
|---|---|
| Channel disconnected mid-job | Publication `failed`, `error="reauthorize:<provider>"`, retry button surfaces "Reconnect first" |
| Refresh token revoked | Same as above |
| Token refresh API 5xx (transient) | 2× exponential retry; final → fail with the upstream code |
| Quota exceeded (YT) | Publication `failed`, `error="quotaExceeded"`, scheduler will not auto-retry; manual Retry available |
| TikTok content rejected (community guidelines) | Publication `failed`, `error="rejected:<reason>"` (verbatim from TT API) |
| Instagram media-container stuck in `IN_PROGRESS` >10min | Poll job marks Publication `failed` with `error="timeout"`; user can retry |
| MP4 missing on disk | Publication `failed`, `error="missing_video_file"` |
| Custom thumbnail >2MB (YT cap) | 400 from `/publish`; UI shows inline error |
| Schedule time in the past at tick-time | Treated as immediate; logged warning |
| HMR / process restart mid-upload | Phase 1 orphan recovery: failed, error="interrupted"; resumable upload sessions are not preserved — Retry starts fresh |

## Testing strategy

### Unit

- `packages/publish/src/youtube.test.ts` — mocked `googleapis`: happy upload returns videoId; 5xx triggers retry; quotaExceeded surfaces verbatim.
- `packages/publish/src/tiktok.test.ts` — mocked fetch: init returns shareId; status polling transitions PROCESSING→PUBLISHED.
- `packages/publish/src/instagram.test.ts` — mocked fetch: container creation → status poll → publish.
- `packages/publish/src/oauth/<provider>.test.ts` — buildAuthUrl includes required scopes; exchangeCode parses tokens; refreshToken bumps expiry.
- `apps/studio/lib/crypto/secret.test.ts` — round-trips arbitrary strings; tampered ciphertext throws.
- `apps/studio/lib/publish/metadata.test.ts` — derives YT/TT/IG variants from a fixture `Script.metadata`; respects length caps; hashtag formatting per platform.
- `apps/studio/lib/publish/normalize.test.ts` — skips well-formed, re-encodes when off-spec; arg construction.
- `apps/studio/lib/jobs/handlers/publish-video.test.ts` — orchestrator happy path per platform with mocks; expired-token → refresh path; channel-disconnected → failed; TikTok enqueues poll_publication; emits to WS hub.

### Integration

- `apps/studio/lib/jobs/handlers/publish-video.integration.test.ts` — uses a single in-process WireMock-style stub server impersonating each platform's endpoints; verifies handler end-to-end against a fixture MP4 and the real DB.

### Smoke (real platform calls)

- `scripts/smoke/phase8-hello.ts` — uploads a 2-second fixture MP4 to YouTube as **private** using `YOUTUBE_TEST_REFRESH_TOKEN` from env, asserts a videoId is returned, then deletes the video via the same API. Skips with informative message if env is missing. **Not** in `smoke:all` (touches a real Google account).

### Manual UI verification (acceptance)

- Connect YouTube in `/channels` → see channel card with @displayName.
- Pick a finished Render → Publish modal → choose YouTube + `unlisted` → Submit.
- Watch `/publications` row go queued → uploading → published with a clickable URL.
- Open the URL in a private window → video plays.
- Disconnect channel → next publish attempt fails with `reauthorize:youtube`; Retry button disabled with tooltip; Connect again → Retry works.

## Out of scope (Phase 9+)

- **Analytics feedback loop** (= Phase 9 candidate). Post-publish, pull views/likes/retention curves back and feed them into the Phase 2 scoring rubric so future ideas are scored against actual performance.
- **Live cross-posting** across platforms with platform-aware re-edits (different captions for TT vs YT).
- **Multiple variants per script** (e.g., A/B-test two hooks).
- **Audience targeting** (paid promotion, ad campaigns).
- **Multi-channel batch publish** — Render All → publish to all channels in one click. (Easy follow-up; the underlying primitives support it.)
- **Comment / community management** — replying to comments from inside the studio.
- **Watermark removal / re-render for platform-specific safe zones.**
- **Per-platform LLM-assisted copy variants** (Claude rewrites the caption for TT vs YT tone).
- **In-app analytics dashboard** (lives in Phase 9).
- **Multi-user / org accounts** — distribution still assumes single-user local-only.

## Acceptance criteria

1. ✅ `/channels` lists provider sections; missing env vars disable the Connect button with a tooltip; configured providers light up.
2. ✅ Connecting YouTube via OAuth round-trips and persists a `Channel` row; encrypted tokens are not readable in the DB without `STUDIO_SECRET_KEY`.
3. ✅ Publish modal on a finished script publishes to YouTube as `unlisted` in under 60s for a typical 30s render.
4. ✅ `/publications` shows the row going through queued → uploading → published, with the canonical URL clickable.
5. ✅ Scheduled publish at `now + 5min` fires within 60s of the deadline.
6. ✅ Token refresh on an expired access token is automatic; user doesn't see anything.
7. ✅ Disconnecting a channel makes pending Publications fail with `reauthorize:<provider>`; Retry is disabled until re-connect.
8. ✅ Failed Publication can be retried in one click; the original error remains in history.
9. ✅ TikTok publish enqueues a poll job that transitions the row to `published` when finalization completes.
10. ✅ `pnpm test` green; `pnpm smoke:phase8` (with `YOUTUBE_TEST_REFRESH_TOKEN`) exits 0; `pnpm smoke:all` still exits 0 (Phase 8 excluded).
11. ✅ All work committed; `phase-8-complete` tag exists.

## Open follow-ups (not blocking Phase 8)

- Instagram tunneling: bake `cloudflared`-style ephemeral tunnel into the publish job for IG's `video_url` requirement (Phase 8 documents the workaround; Phase 8.1 automates it).
- Quota dashboard widget on `/publications` showing YT's remaining daily quota.
- "Save draft, publish later" mode that writes a YT draft and surfaces an "Edit on YouTube" link.
- Comment-thread mirror — pull recent comments for a published video and surface them in `/publications/<id>`.
- Per-script publish "template" — same metadata variants reused across all scripts of a chapter.
- Bulk publish from `/renders` (Publish All).
- Channel-scoped niche / persona — different default metadata transformations per channel.
- Hashtag suggestion based on trending tags (TikTok/YT trending APIs).
- Two-factor token storage option (system keychain via `keytar`) instead of file-based encryption.

## Master spec hook

After Phase 8 lands, the MVP-complete loop extends:

> Upload a finance book PDF → review chapters → for one chapter, see scored ideas with suggestions → approve and accept suggestions → 10-15 scripts generated → b-roll picked → render all → **publish all to YouTube as unlisted drafts** → review on the platform → flip to public.

End-to-end on M3 in under 35 minutes per chapter (the +5 min over Phase 7 covers per-script upload time at YT's typical ingest speed).
