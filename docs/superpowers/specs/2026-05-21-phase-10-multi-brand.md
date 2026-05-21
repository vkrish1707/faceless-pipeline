# Phase 10 — Multi-Brand & Per-Brand Persona

> Implementation phase for the post-analytics scaling layer of [[2026-05-19-faceless-content-pipeline-design]]. Depends on every prior phase. Hardest dependency: [[2026-05-21-phase-8-distribution]] (the `Channel` model is what brands are wired to) and [[2026-05-21-phase-9-analytics-feedback]] (per-niche aggregation becomes per-brand aggregation).

## Goal

Turn the studio from "one show" into "N distinct shows under one roof." A **Brand** is a logical editorial identity: niche, persona, voice, theme, plus the set of OAuth-connected Channels it publishes to. Books get assigned to a Brand at upload; every downstream phase (score, script, synth, render, publish, analytics) becomes brand-aware so each brand develops its own performance history and aesthetic.

**Phase 10 is done when:** a user can create two Brands ("Money Lab" + "Focus Mode") with distinct persona prompts, voices, and theme tokens; upload one book per Brand; the resulting scripts pick up brand-scoped voice + persona automatically; renders use the brand's theme; publishes go to the brand's connected channels; `/analytics?brand=...` shows segmented performance; and a brand-aware historical-signals block reaches the Phase 2 score prompt so future scoring is scoped to the same brand.

## Architecture

```
┌──────────────────── apps/studio ─────────────────────────┐
│  /brands              — list + create                     │
│  /brands/[id]         — name, persona, voice, theme,      │
│                          niche, connected channels         │
│  /books/new           — brand picker (default = unbranded) │
│                                                            │
│  GET  /api/brands                                          │
│  POST /api/brands                                          │
│  PATCH /api/brands/[id]                                    │
│  DELETE /api/brands/[id]                                   │
│  POST /api/brands/[id]/channels  (add link)                │
│  DELETE /api/brands/[id]/channels/[channelId]              │
└──────────────────────────┬───────────────────────────────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
       ┌────▼─────┐ ┌──────▼──────┐ ┌─────▼──────────────┐
       │ db       │ │ pipeline    │ │ remotion           │
       │  Brand   │ │  prompts    │ │  theme resolution  │
       │  Books←→Brand │  read brand   │  finance-dark vs  │
       │  Brand←→Channel│ persona+voice │  brand override   │
       └──────────┘ └─────────────┘ └────────────────────┘
                           │
                ┌──────────▼─────────────┐
                │ /analytics?brand=...   │
                │ HistoricalSignals are  │
                │ brand-scoped not just  │
                │ niche-scoped           │
                └────────────────────────┘
```

### Package boundaries

- **`packages/pipeline/`** — `prompts.ts` gets an optional `brandPersona: string` parameter on `SCORING_SYSTEM_PROMPT` / `SCRIPT_SYSTEM_PROMPT` / `SUGGESTION_SYSTEM_PROMPT` helpers that appends a `BRAND PERSONA` block when present. Backward-compatible (no brand → same prompts as today).
- **`packages/remotion/`** — `theme/resolveTheme.ts` (new pure helper) returns a `Theme` object given a base key + optional `themeOverrides` JSON (partial token map). Phase 6's `Video.tsx` uses it; defaults stay `finance-dark`.
- **`apps/studio/lib/brand/resolve.ts`** — `resolveBrandForBook(bookId)` → `{ niche, personaPrompt, voiceModel, themeKey, themeOverrides, channels[] }`. Falls back to the unbranded defaults Setting-wide today. Used by every job handler that needs brand context.
- **`apps/studio/lib/jobs/handlers/*`** — minimal touch: each handler that calls a `packages/pipeline` helper now passes `resolveBrandForBook(bookId)` first. No behavior change when book is unbranded.

## Data model additions

```prisma
model Brand {
  id              String   @id @default(cuid())
  slug            String   @unique          // url-safe, 3-32 chars, [a-z0-9-]
  name            String                     // display name
  niche           String                     // overrides Book.niche for this brand
  personaPrompt   String                     // free-form, ≤ 1000 chars; injected into scoring/script/suggest as system text
  voiceModel      String                     // "en_US-ryan-high" etc; falls back to Setting("default_voice") when null
  themeKey        String                     // "finance-dark" | "finance-light" | "custom"
  themeOverrides  Json?                      // partial Remotion theme tokens, e.g. { textHighlight: "#FF00AA" }
  archived        Boolean  @default(false)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  books           Book[]
  brandChannels   BrandChannel[]
}

// Many-to-many: a Brand publishes to a set of platform Channels (Phase 8).
model BrandChannel {
  brandId    String
  channelId  String
  brand      Brand   @relation(fields: [brandId], references: [id], onDelete: Cascade)
  channel    Channel @relation(fields: [channelId], references: [id], onDelete: Cascade)
  createdAt  DateTime @default(now())

  @@id([brandId, channelId])
  @@index([channelId])
}

// Book gains an optional brand.
model Book {
  // ...existing fields
  brandId    String?
  brand      Brand?  @relation(fields: [brandId], references: [id])

  @@index([brandId])
}
```

Migration name: `phase10_brand`. Existing books stay `brandId = null` — fully backward-compatible.

No new `Job.type`. No new Setting keys (defaults still live in `Setting`; brands override them).

## User flow

### Creating a Brand (`/brands/new`)

A small form:
- **Name** (required, 2-60 chars).
- **Slug** auto-derived from name; editable.
- **Niche** dropdown — same allow-list Phase 2 uses (`investing`, `personal_finance`, `productivity`, custom string).
- **Persona prompt** textarea — placeholder example: "You're writing for a former hedge fund analyst who teaches retail investors. Be concrete, never preachy, mix dry humor with concrete dollar amounts."
- **Voice** dropdown — reads the available voices Setting helper already exposes (`en_US-ryan-high`, `en_US-amy-medium`, "use default").
- **Theme** radio — `finance-dark` / `finance-light` / `custom`. When `custom`, two color pickers expose `textHighlight` + `accent` overrides (the two tokens most users want to tweak; everything else inherits the base theme).
- **Channels** multi-select — populated from Phase 8 `/channels` (already connected ones). Optional at creation.

Submit → `POST /api/brands` → row inserted → redirect to `/brands/[id]`.

### `/brands` index

- One card per brand: name, niche pill, voice pill, channel platforms (icons), book count.
- Hover: "Edit / Archive". Archived brands are hidden from the upload picker but kept for historical analytics.
- Header **+ New brand** button.

### `/brands/[id]`

Same form as `/brands/new`, prefilled. Plus:
- **Connected channels** with a "Disconnect" per row + an "Add channel" picker.
- **Stats panel**: book count, publication count, total views (reads Phase 9 aggregates).
- **Recent publications** table (latest 10 with platform + views).
- **Archive** button (does not delete; flips `archived = true`).

### `/books/new` — Brand picker added

The existing upload form gains a **Brand** dropdown above niche. When a brand is picked, **niche** is locked to the brand's niche and visually annotated `(from brand: <name>)`. When "Unbranded" is picked (default), niche stays editable.

### Cascade through downstream phases

For every job that does Claude-prompt construction or Remotion render, `resolveBrandForBook(bookId)` resolves:
- `niche`: brand override or book's own niche.
- `personaPrompt`: brand's prompt or empty string (no block added when empty).
- `voiceModel`: brand voice or `Setting("default_voice")`.
- `themeKey + themeOverrides`: brand theme or "finance-dark" with no overrides.
- `channels[]`: brand's channel list (Phase 8 publish flow defaults to selecting these).

Specifically:
- **Phase 2 score (`packages/pipeline/score.ts`)** — when `personaPrompt` non-empty, append a third system block:
  ```
  BRAND PERSONA:
  <text>
  Lean into this voice when scoring; reward ideas that fit the persona, penalize ones that contradict it.
  ```
- **Phase 2 suggest (`packages/pipeline/suggest.ts`)** — same persona block, plus suggestion rubric is aware that merges/drops should preserve the persona voice.
- **Phase 3 generateScript (`packages/pipeline/script.ts`)** — persona block becomes a third cached system text. The hook/body/cta will pick up the persona naturally.
- **Phase 4 synthesize (`apps/studio/lib/jobs/handlers/synthesize-script.ts`)** — passes the brand-resolved `voiceModel` to Piper instead of the Setting default.
- **Phase 6 render (`packages/remotion/`)** — `Video.tsx` resolves the theme via `resolveTheme(themeKey, themeOverrides)` from the input props.
- **Phase 8 publish** — the publish modal's channel checkboxes default to the brand's channels (still overridable).
- **Phase 9 analytics aggregator** — `aggregateForScoring({ brandId, niche, lookbackDays })` becomes brand-aware. When `brandId` is set, the sample is scoped to that brand's publications.

### Score-prompt with brand persona (concrete example)

```
SYSTEM:
  [Phase 2 SCORING_SYSTEM_PROMPT — unchanged]

SYSTEM (ephemeral cache):
  [chapter rawText]

SYSTEM (ephemeral cache, NEW):
  BRAND PERSONA:
  You're writing for a former hedge fund analyst who teaches retail
  investors. Be concrete, never preachy, mix dry humor with concrete
  dollar amounts.
  Lean into this voice when scoring; reward ideas that fit the persona,
  penalize ones that contradict it.

SYSTEM (ephemeral cache, when Phase 9 enabled + sample-size met):
  HISTORICAL PERFORMANCE (last 30 days, brand=money-lab, sample=23):
  ...

USER:
  [score user prompt for this idea]
```

Phase 9's historical block now also gains a `brand=<slug>` filter when present, so brand-scoped signals don't bleed into other brands.

## Theme override resolution (`packages/remotion/src/theme/resolveTheme.ts`)

```ts
export function resolveTheme(
  key: "finance-dark" | "finance-light" | "custom",
  overrides?: Partial<Record<keyof Theme, string | number>>
): Theme {
  const base = key === "finance-light" ? financeLight : financeDark;
  if (!overrides || Object.keys(overrides).length === 0) return base;
  return { ...base, ...overrides };
}
```

`Video.tsx` reads `theme = resolveTheme(props.themeKey, props.themeOverrides)` and threads it down as before. Existing renders (no brand assigned) hit the `overrides === undefined` fast path and stay byte-identical to Phase 6 output.

## Error handling summary

| Failure | Behavior |
|---|---|
| Brand voice model file missing | Phase 4 synth job fails with `VoiceModelMissingError` (existing actionable message) |
| Brand themeKey="custom" but overrides empty | Falls back to `finance-dark` with a warning logged once |
| Brand has 0 connected channels and user picks brand-only publish | Publish modal shows "Brand has no channels — connect one in /brands/<id> first" |
| Slug collision on create | 409 with `error: "slug_taken"`; client appends `-2`, `-3`, etc. |
| Deleting a brand with books attached | 409 with `error: "brand_in_use: <bookCount> books reference this brand"` — user must reassign or archive instead |
| Archived brand on a book | Score / script / render still use the brand's resolved values (history is preserved); UI tags the book with "Archived brand" pill |
| Persona prompt > 1000 chars | 400 from PATCH; client shows inline counter |

## Testing strategy

### Unit

- `apps/studio/lib/brand/resolve.test.ts` — `resolveBrandForBook`:
  - unbranded book → fallback defaults,
  - branded book → brand fields override,
  - archived brand → still resolves (only excluded from upload picker),
  - missing brand row (orphan FK) → falls back with warning.
- `packages/pipeline/src/score.test.ts` — extend: with `brandPersona` set, system array gains a `BRAND PERSONA:` block; without, identical to current.
- `packages/pipeline/src/script.test.ts` — same.
- `packages/pipeline/src/suggest.test.ts` — same.
- `packages/remotion/src/theme/resolveTheme.test.ts` — base, overrides merge, unknown key falls back to dark.
- `apps/studio/app/api/brands/route.test.ts` — POST validates schema, dedupes slug, 409 on collision.
- `apps/studio/app/api/brands/[id]/route.test.ts` — PATCH partial validates field caps; DELETE refuses when books attached.

### Integration

- `apps/studio/lib/brand/cascade.integration.test.ts` — creates a Brand, attaches a Book, runs `extract_ideas → score_chapter → generate_script` jobs with mocked Anthropic. Asserts Claude SDK was called with the persona block in `system`.
- `apps/studio/lib/jobs/handlers/synthesize-script.integration.test.ts` — assert `synthesize` is invoked with the brand's voice path, not the default.

### Smoke

- `scripts/smoke/phase10-hello.ts` — fixture creates a Brand → assigns to a fixture Book → runs the score pipeline against mocked Claude, asserts the persona block is present in the request body captured by the mock. Local only ($0). Registered as `pnpm smoke:phase10`. Added to `smoke:all`.

### Manual UI verification (acceptance)

- Create two brands with distinct persona prompts.
- Upload the same book under each brand (different `brandId`).
- Score → compare the two chapters' Idea scores; they should diverge meaningfully (persona influences rubric).
- Generate scripts from each → hook/body wording differs in tone.
- Synth one script per brand → audio uses the brand's voice (audible difference between Ryan and Amy).
- Render one per brand with different `themeOverrides.textHighlight` → the kinetic captions render in the custom color.
- Publish → brand's connected channels are pre-checked in the modal.
- `/analytics?brand=<slug>` → segmented view; numbers don't mix between brands.

## Out of scope (Phase 11+)

- **Per-brand intro/outro stings** (audio bumpers prepended/appended to every render). Easy add but doubles the rendering complexity.
- **Brand logos / watermarks** in the Remotion composition. Needs an `assets/brands/<slug>/logo.png` story.
- **Brand cloning** — "duplicate this brand with a tweak".
- **Multi-author per brand** — multiple users with different role permissions on one brand.
- **Brand-level cost caps** — refuse Claude calls when a brand's `ApiUsage.costUsd` sum this month exceeds a budget.
- **Cross-brand idea suggestions** — "this idea fits Brand B better than Brand A".
- **Brand-aware A/B testing** — variants generated under the same brand to compare hooks.
- **Brand-scoped chart palettes** (Phase 6 chart-reveal would honor brand color tokens automatically — partially already covered by themeOverrides, but a richer per-chart story is out of scope).
- **Brand cover images / favicon / social og:image** assets shared on the dashboard.

## Acceptance criteria

1. ✅ Create / edit / archive Brand via UI; slug uniqueness enforced.
2. ✅ Book upload offers a Brand picker; "Unbranded" remains the default and works exactly as before.
3. ✅ Scoring a chapter on a branded book includes a `BRAND PERSONA:` block in the system prompt that's absent on unbranded books.
4. ✅ Generated scripts pick up the persona naturally (manual inspection: the hook reflects the brand voice).
5. ✅ Synthesize on a branded book uses the brand's `voiceModel` instead of `Setting("default_voice")`.
6. ✅ Render on a branded book applies `themeOverrides`; visible diff in the kinetic-caption highlight color.
7. ✅ Publish modal's channel checkboxes default to the brand's `BrandChannel[]`; user can still pick others.
8. ✅ `/analytics?brand=<slug>` segments queries; Phase 9's HISTORICAL PERFORMANCE block also adds a `brand=<slug>` line and uses brand-scoped median.
9. ✅ Deleting a brand with attached books returns 409; archiving works and hides from picker.
10. ✅ Existing books (brandId null) continue working byte-identically — no behavior change for unbranded flow.
11. ✅ `pnpm test` green; `pnpm smoke:phase10` exits 0; `pnpm smoke:all` exits 0 (phase10 included).
12. ✅ All work committed; `phase-10-complete` tag exists.

## Open follow-ups (not blocking Phase 10)

- Per-brand intro/outro stings (audio bumpers).
- Brand logo overlay in Remotion (corner watermark).
- Brand-level cost caps with auto-shutoff.
- Brand cloning ("Duplicate as ...").
- Brand-scoped niche style guides (extending Phase 3's `NICHE_STYLE_GUIDE`).
- Cross-brand "this idea would do better under <other brand>" suggestion.
- Brand-aware A/B variants (overlap with potential Phase 11 = experiments).
- Brand-scoped Pexels orientation / vibe filter (e.g., one brand prefers warm-toned photos).
- Brand export/import as JSON for backup or sharing.

## Master spec hook

After Phase 10 lands, the pipeline scales horizontally:

> One Studio installation runs **N brands**. Each brand has its own niche, persona, voice, theme, and connected channels. Books are assigned to a brand at upload. Every downstream phase — scoring, scripting, voice, render, publish, analytics — becomes brand-aware automatically. Analytics in Phase 9 segments per brand, so each brand's performance history sharpens scoring within that brand without cross-contamination.

The MVP loop becomes the "publishing studio" loop — multiple shows, all learning independently.
