# faceless-pipeline

Local-first Mac M3 tool for turning finance books into faceless short-form videos.

See `docs/superpowers/specs/2026-05-19-faceless-content-pipeline-design.md` for the design spec.

## Setup

```bash
pnpm install
cp .env.local.example .env.local   # then fill in keys
pnpm setup:piper                   # downloads Ryan + Amy voice models (~100MB)
pnpm setup:whisper                 # downloads small.en model (~466MB)
pnpm smoke:all                     # verify every dependency works
pnpm dev                           # http://localhost:3000
```

## Stack
Next.js 15 · Prisma + SQLite · Claude Sonnet 4.6 · Piper TTS · whisper.cpp · Pexels · Remotion 4

## Scripts
- `pnpm dev` — start studio app
- `pnpm smoke:all` — verify every external dependency
- `pnpm test` — run unit tests
