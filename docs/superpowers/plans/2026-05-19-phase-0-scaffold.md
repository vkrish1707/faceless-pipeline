# Phase 0: Scaffold & Smoke Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Next.js studio app and prove every external dependency (Claude API, Piper TTS, whisper.cpp, Pexels API, Remotion) works end-to-end via standalone smoke scripts on the M3 — before any UI features are built.

**Architecture:** Single Next.js 15 (App Router) app at `apps/studio` with internal `packages/*` workspaces, SQLite via Prisma, environment validation with zod, smoke scripts in `scripts/smoke/` that each prove one external dependency, and a `/health` route + status page that aggregates dep readiness.

**Tech Stack:** Next.js 15, TypeScript, Tailwind, shadcn/ui, Prisma + SQLite, pnpm workspaces, Anthropic SDK, Pexels API, Piper TTS (Homebrew), whisper.cpp (Homebrew), Remotion 4, Vitest, zod, pino.

---

## Prerequisites (user must complete BEFORE starting)

- **Node.js ≥ 20** installed (`node -v`)
- **pnpm ≥ 9** installed (`pnpm -v`; if missing: `npm i -g pnpm`)
- **Homebrew** installed (`brew -v`)
- **ffmpeg** available (`ffmpeg -version`; if missing: `brew install ffmpeg`)
- **Anthropic API key** (user has this)
- **Pexels API key** — get free at https://www.pexels.com/api/ (1 min signup, no credit card)

If any of these are missing, stop and resolve before running tasks.

---

## File Structure (produced by this phase)

```
faceless-pipeline/
├── apps/
│   └── studio/                          # Next.js app
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── page.tsx                 # landing page with system-status panel
│       │   └── api/
│       │       └── health/route.ts      # GET /api/health
│       ├── components/ui/               # shadcn primitives
│       ├── lib/
│       │   ├── env.ts                   # zod-validated env loader
│       │   ├── db.ts                    # prisma singleton client
│       │   └── deps.ts                  # dependency-check helpers
│       ├── package.json
│       ├── tsconfig.json
│       ├── tailwind.config.ts
│       ├── postcss.config.mjs
│       └── next.config.ts
├── packages/
│   ├── remotion/                        # Remotion compositions
│   │   ├── src/
│   │   │   ├── index.ts                 # registerRoot
│   │   │   ├── Root.tsx                 # Composition registry
│   │   │   └── HelloVideo.tsx           # 2-second smoke composition
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── pipeline/                        # (empty stub)
│   ├── parsers/                         # (empty stub)
│   ├── trends/                          # (empty stub)
│   ├── tts/                             # (empty stub)
│   ├── captions/                        # (empty stub)
│   └── assets/                          # (empty stub)
├── prisma/
│   ├── schema.prisma                    # full data model from spec §4
│   └── migrations/                      # generated
├── scripts/
│   ├── smoke/
│   │   ├── claude-hello.ts
│   │   ├── pexels-hello.ts
│   │   ├── piper-hello.ts
│   │   ├── whisper-hello.ts
│   │   └── remotion-hello.ts
│   └── setup/
│       ├── install-piper.sh             # installs piper + downloads Ryan+Amy voices
│       └── install-whisper.sh           # installs whisper-cpp + downloads small.en
├── assets/
│   ├── voices/                          # piper .onnx models (gitignored)
│   ├── whisper/                         # ggml-*.bin models (gitignored)
│   └── cache/                           # downloaded b-roll (gitignored)
├── data/
│   └── studio.db                        # sqlite (gitignored)
├── logs/                                # daily pino logs (gitignored)
├── output/                              # rendered MP4s (gitignored)
├── package.json                         # workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.config.ts
├── .env.local.example
├── README.md
└── .gitignore                           # already exists
```

---

## Task 1: Initialize pnpm workspace + root tooling

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `README.md`
- Modify: `.gitignore` (already exists, verify entries)

- [ ] **Step 1: Verify .gitignore covers workspace artifacts**

Read `.gitignore`. Confirm it contains: `node_modules`, `.next`, `dist`, `.env.local`, `logs/`, `data/*.db`, `output/`, `assets/cache/`, `assets/voices/*.onnx`, `assets/whisper/*.bin`. If any are missing, add them.

- [ ] **Step 2: Create workspace root `package.json`**

```json
{
  "name": "faceless-pipeline",
  "version": "0.0.1",
  "private": true,
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "dev": "pnpm --filter @studio/app dev",
    "build": "pnpm -r build",
    "test": "vitest run",
    "test:watch": "vitest",
    "smoke:claude": "pnpm tsx scripts/smoke/claude-hello.ts",
    "smoke:pexels": "pnpm tsx scripts/smoke/pexels-hello.ts",
    "smoke:piper": "pnpm tsx scripts/smoke/piper-hello.ts",
    "smoke:whisper": "pnpm tsx scripts/smoke/whisper-hello.ts",
    "smoke:remotion": "pnpm tsx scripts/smoke/remotion-hello.ts",
    "smoke:all": "pnpm smoke:claude && pnpm smoke:pexels && pnpm smoke:piper && pnpm smoke:whisper && pnpm smoke:remotion",
    "setup:piper": "bash scripts/setup/install-piper.sh",
    "setup:whisper": "bash scripts/setup/install-whisper.sh"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 3: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 4: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "paths": {
      "@pipeline/*": ["./packages/pipeline/src/*"],
      "@parsers/*": ["./packages/parsers/src/*"],
      "@trends/*": ["./packages/trends/src/*"],
      "@tts/*": ["./packages/tts/src/*"],
      "@captions/*": ["./packages/captions/src/*"],
      "@assets-pkg/*": ["./packages/assets/src/*"],
      "@remotion-pkg/*": ["./packages/remotion/src/*"]
    }
  },
  "exclude": ["node_modules", "dist", ".next"]
}
```

- [ ] **Step 5: Create `README.md`**

```markdown
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
```

- [ ] **Step 6: Install root dev dependencies**

Run: `pnpm install`
Expected: Lockfile created, `node_modules/` populated, no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json README.md pnpm-lock.yaml .gitignore
git commit -m "chore: initialize pnpm workspace + root tooling"
```

---

## Task 2: Initialize Next.js studio app at apps/studio

**Files:**
- Create: `apps/studio/package.json`
- Create: `apps/studio/tsconfig.json`
- Create: `apps/studio/next.config.ts`
- Create: `apps/studio/postcss.config.mjs`
- Create: `apps/studio/tailwind.config.ts`
- Create: `apps/studio/app/layout.tsx`
- Create: `apps/studio/app/page.tsx`
- Create: `apps/studio/app/globals.css`

- [ ] **Step 1: Create `apps/studio/package.json`**

```json
{
  "name": "@studio/app",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: Create `apps/studio/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"],
      "@pipeline/*": ["../../packages/pipeline/src/*"],
      "@parsers/*": ["../../packages/parsers/src/*"],
      "@trends/*": ["../../packages/trends/src/*"],
      "@tts/*": ["../../packages/tts/src/*"],
      "@captions/*": ["../../packages/captions/src/*"],
      "@assets-pkg/*": ["../../packages/assets/src/*"],
      "@remotion-pkg/*": ["../../packages/remotion/src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `apps/studio/next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: "50mb" },  // for PDF uploads later
  },
};

export default nextConfig;
```

- [ ] **Step 4: Create `apps/studio/postcss.config.mjs`**

```js
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

- [ ] **Step 5: Create `apps/studio/tailwind.config.ts`**

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0B0F1A",
        ink: "#FFFFFF",
        accent: "#00FF85",
        gold: "#FFD700",
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 6: Create `apps/studio/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body {
  background-color: #0B0F1A;
  color: #FFFFFF;
}
```

- [ ] **Step 7: Create `apps/studio/app/layout.tsx`**

```tsx
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Faceless Pipeline",
  description: "Local-first faceless content studio",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
```

- [ ] **Step 8: Create `apps/studio/app/page.tsx`** (placeholder; real status panel comes in Task 11)

```tsx
export default function HomePage() {
  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold">Faceless Pipeline</h1>
      <p className="mt-2 text-white/70">System status will appear here.</p>
    </main>
  );
}
```

- [ ] **Step 9: Install + verify dev server boots**

Run: `pnpm install`
Run: `pnpm --filter @studio/app dev`
Expected: server starts on `http://localhost:3000`; visiting it shows the heading.
Press Ctrl-C to stop.

- [ ] **Step 10: Commit**

```bash
git add apps/studio pnpm-lock.yaml
git commit -m "feat(studio): scaffold Next.js 15 app with Tailwind"
```

---

## Task 3: Install shadcn/ui primitives

**Files:**
- Create: `apps/studio/components.json`
- Create: `apps/studio/lib/utils.ts`
- Create: `apps/studio/components/ui/button.tsx`
- Create: `apps/studio/components/ui/card.tsx`
- Create: `apps/studio/components/ui/badge.tsx`
- Modify: `apps/studio/app/globals.css` (add CSS variables)
- Modify: `apps/studio/tailwind.config.ts` (add shadcn extensions)

- [ ] **Step 1: Install shadcn deps**

Run from repo root:
```bash
pnpm --filter @studio/app add class-variance-authority clsx tailwind-merge lucide-react tailwindcss-animate
```
Expected: deps added, no errors.

- [ ] **Step 2: Create `apps/studio/components.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "app/globals.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
```

- [ ] **Step 3: Create `apps/studio/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Update `apps/studio/app/globals.css` with CSS variables**

Replace entire file with:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 220 30% 6%;
    --foreground: 0 0% 100%;
    --card: 220 25% 9%;
    --card-foreground: 0 0% 100%;
    --primary: 152 100% 50%;
    --primary-foreground: 220 30% 6%;
    --muted: 220 15% 18%;
    --muted-foreground: 0 0% 70%;
    --border: 220 15% 18%;
    --radius: 0.5rem;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

- [ ] **Step 5: Update `apps/studio/tailwind.config.ts` to use CSS vars**

Replace entire file with:
```ts
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        border: "hsl(var(--border))",
      },
      borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)" },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
```

- [ ] **Step 6: Create `apps/studio/components/ui/button.tsx`**

```tsx
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        outline: "border border-border bg-transparent hover:bg-muted",
        ghost: "hover:bg-muted",
      },
      size: { default: "h-10 px-4 py-2", sm: "h-9 px-3", lg: "h-11 px-8" },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";
```

- [ ] **Step 7: Install Radix Slot**

Run: `pnpm --filter @studio/app add @radix-ui/react-slot`

- [ ] **Step 8: Create `apps/studio/components/ui/card.tsx`**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...p }, ref) => (
    <div ref={ref} className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)} {...p} />
  )
);
Card.displayName = "Card";

export const CardHeader = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...p} />
);
export const CardTitle = ({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn("text-lg font-semibold leading-none", className)} {...p} />
);
export const CardContent = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("p-6 pt-0", className)} {...p} />
);
```

- [ ] **Step 9: Create `apps/studio/components/ui/badge.tsx`**

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        outline: "border border-border text-foreground",
        success: "bg-green-500/20 text-green-300",
        warn: "bg-yellow-500/20 text-yellow-200",
        error: "bg-red-500/20 text-red-300",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
```

- [ ] **Step 10: Verify Button renders**

Edit `apps/studio/app/page.tsx`:
```tsx
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="p-8 space-y-4">
      <h1 className="text-3xl font-bold">Faceless Pipeline</h1>
      <Button>Test button</Button>
    </main>
  );
}
```

Run: `pnpm dev`
Expected: button renders green-on-dark.
Stop with Ctrl-C.

- [ ] **Step 11: Commit**

```bash
git add apps/studio
git commit -m "feat(studio): add shadcn/ui base components"
```

---

## Task 4: Environment validation with zod

**Files:**
- Create: `apps/studio/lib/env.ts`
- Create: `.env.local.example`

- [ ] **Step 1: Create `.env.local.example`**

```
# Required
ANTHROPIC_API_KEY=sk-ant-...
PEXELS_API_KEY=...

# Optional
LOG_LEVEL=info
RENDER_CONCURRENCY=2
NODE_ENV=development
```

- [ ] **Step 2: Create `apps/studio/lib/env.ts`**

```ts
import { z } from "zod";

const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(20),
  PEXELS_API_KEY: z.string().min(10),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  RENDER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment variables:\n${issues}\n\nCopy .env.local.example to .env.local and fill in values.`);
  }
  cached = parsed.data;
  return cached;
}

export function maskedEnv() {
  const e = getEnv();
  return {
    anthropic: e.ANTHROPIC_API_KEY.slice(0, 8) + "..." + e.ANTHROPIC_API_KEY.slice(-4),
    pexels: e.PEXELS_API_KEY.slice(0, 4) + "..." + e.PEXELS_API_KEY.slice(-4),
    logLevel: e.LOG_LEVEL,
    renderConcurrency: e.RENDER_CONCURRENCY,
  };
}
```

- [ ] **Step 3: User must populate `.env.local`**

This is a user action, not an agent action. The user copies the example file and fills in their keys:
```bash
cp .env.local.example .env.local
# edit .env.local — paste real ANTHROPIC_API_KEY and PEXELS_API_KEY
```

If the agent runs this step and the keys aren't filled in, smoke tests in later tasks will fail with a clear validation error.

- [ ] **Step 4: Add `.env.local` to git ignore confirmation**

Verify `.gitignore` contains `.env.local`. Already added in Task 1 Step 1.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/lib/env.ts .env.local.example
git commit -m "feat(studio): zod-validated env loader"
```

---

## Task 5: Prisma + SQLite with full schema

**Files:**
- Create: `prisma/schema.prisma`
- Create: `apps/studio/lib/db.ts`
- Modify: `apps/studio/package.json` (add @prisma/client + prisma scripts)
- Modify: workspace `package.json` (add db:migrate script)

- [ ] **Step 1: Install Prisma**

Run from repo root:
```bash
pnpm --filter @studio/app add @prisma/client
pnpm --filter @studio/app add -D prisma
```

- [ ] **Step 2: Create `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = "file:../data/studio.db"
}

model Book {
  id         String    @id @default(cuid())
  title      String
  filePath   String
  niche      String
  pageCount  Int
  status     String
  createdAt  DateTime  @default(now())
  chapters   Chapter[]
}

model Chapter {
  id         String  @id @default(cuid())
  bookId     String
  book       Book    @relation(fields: [bookId], references: [id])
  title      String
  orderIndex Int
  startPage  Int
  endPage    Int
  rawText    String
  status     String
  ideas      Idea[]
}

model Idea {
  id              String   @id @default(cuid())
  chapterId       String
  chapter         Chapter  @relation(fields: [chapterId], references: [id])
  title           String
  summary         String
  targetLengthSec Int
  score           Int?
  scoreBreakdown  Json?
  trendSignals    Json?
  flags           Json?
  seriesId        String?
  status          String
  script          Script?
}

model Script {
  id          String   @id @default(cuid())
  ideaId      String   @unique
  idea        Idea     @relation(fields: [ideaId], references: [id])
  hook        String
  body        String
  cta         String
  visualBeats Json
  metadata    Json
  score       Int?
  status      String
  render      Render?
}

model Asset {
  id        String    @id @default(cuid())
  scriptId  String?
  beatIndex Int?
  type      String
  sourceUrl String?
  localPath String
  keyword   String?
  pickedAt  DateTime?
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
  status       String
  progress     Int       @default(0)
  error        String?
  startedAt    DateTime?
  completedAt  DateTime?
}

model TrendSnapshot {
  id        String   @id @default(cuid())
  keyword   String
  source    String
  data      Json
  fetchedAt DateTime @default(now())

  @@unique([keyword, source])
}

model ApiUsage {
  id        String   @id @default(cuid())
  service   String
  endpoint  String
  tokensIn  Int?
  tokensOut Int?
  costUsd   Float?
  traceId   String?
  createdAt DateTime @default(now())
}
```

- [ ] **Step 3: Add db scripts to workspace root `package.json`**

Edit the `scripts` block in root `package.json`, adding:
```json
"db:generate": "pnpm --filter @studio/app exec prisma generate --schema ../../prisma/schema.prisma",
"db:migrate": "pnpm --filter @studio/app exec prisma migrate dev --schema ../../prisma/schema.prisma",
"db:studio": "pnpm --filter @studio/app exec prisma studio --schema ../../prisma/schema.prisma"
```

- [ ] **Step 4: Create `data/` directory**

Run: `mkdir -p data`

- [ ] **Step 5: Run initial migration**

Run: `pnpm db:migrate --name init`
Expected: prompts for confirmation, creates `data/studio.db`, generates client to `node_modules/.prisma/client`.

- [ ] **Step 6: Create `apps/studio/lib/db.ts`**

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
```

- [ ] **Step 7: Verify db client works**

Create a temp file `apps/studio/lib/__db-check.ts`:
```ts
import { db } from "./db";

async function main() {
  await db.$queryRaw`SELECT 1`;
  console.log("OK: db connection works");
  await db.$disconnect();
}
main();
```

Run: `pnpm --filter @studio/app exec tsx lib/__db-check.ts`
Expected: prints `OK: db connection works`.

Delete the temp file: `rm apps/studio/lib/__db-check.ts`

- [ ] **Step 8: Commit**

```bash
git add prisma apps/studio/lib/db.ts apps/studio/package.json package.json data/.gitkeep
git commit -m "feat(db): prisma + sqlite with full schema"
```

(If `data/.gitkeep` doesn't exist, `touch data/.gitkeep` and add it. The `data/*.db` ignore keeps the actual db file out.)

---

## Task 6: Create empty package stubs

**Files:**
- Create: `packages/pipeline/{package.json,tsconfig.json,src/index.ts}`
- Create: `packages/parsers/{package.json,tsconfig.json,src/index.ts}`
- Create: `packages/trends/{package.json,tsconfig.json,src/index.ts}`
- Create: `packages/tts/{package.json,tsconfig.json,src/index.ts}`
- Create: `packages/captions/{package.json,tsconfig.json,src/index.ts}`
- Create: `packages/assets/{package.json,tsconfig.json,src/index.ts}`

- [ ] **Step 1: Create each stub package**

For each of `pipeline, parsers, trends, tts, captions, assets`, create the same three-file pattern. Here's `packages/pipeline`:

`packages/pipeline/package.json`:
```json
{
  "name": "@studio/pipeline",
  "version": "0.0.1",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

`packages/pipeline/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*"]
}
```

`packages/pipeline/src/index.ts`:
```ts
export const PLACEHOLDER = "pipeline package — populated in later phases";
```

Repeat for the other 5 packages, replacing `pipeline` with `parsers / trends / tts / captions / assets` in the `name` field and the placeholder string.

- [ ] **Step 2: Re-run install to link workspace packages**

Run: `pnpm install`
Expected: no errors; each package shows up under `node_modules/@studio/*` as a symlink.

- [ ] **Step 3: Commit**

```bash
git add packages
git commit -m "chore: scaffold empty package workspaces"
```

---

## Task 7: Anthropic SDK + claude-hello smoke

**Files:**
- Create: `scripts/smoke/claude-hello.ts`

- [ ] **Step 1: Install Anthropic SDK at workspace root**

Run: `pnpm add -w @anthropic-ai/sdk dotenv`

- [ ] **Step 2: Create `scripts/smoke/claude-hello.ts`**

```ts
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("FAIL: ANTHROPIC_API_KEY missing in .env.local");
  process.exit(1);
}

const client = new Anthropic({ apiKey });

async function main() {
  const t0 = Date.now();
  const res = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 64,
    messages: [{ role: "user", content: "Reply with exactly: PIPELINE OK" }],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const dt = Date.now() - t0;
  console.log(`response: ${text.trim()}`);
  console.log(`latency:  ${dt}ms`);
  console.log(`tokens:   in=${res.usage.input_tokens} out=${res.usage.output_tokens}`);
  if (!text.includes("PIPELINE OK")) {
    console.error("FAIL: did not get expected response");
    process.exit(1);
  }
  console.log("OK: claude-hello passed");
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
```

- [ ] **Step 3: Run the smoke**

Run: `pnpm smoke:claude`
Expected: prints `response: PIPELINE OK`, latency under 5s, exits 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke/claude-hello.ts package.json pnpm-lock.yaml
git commit -m "feat(smoke): claude-hello"
```

---

## Task 8: Pexels client + pexels-hello smoke

**Files:**
- Create: `packages/assets/src/pexels.ts`
- Create: `packages/assets/src/index.ts` (re-export)
- Create: `packages/assets/src/pexels.test.ts`
- Create: `scripts/smoke/pexels-hello.ts`

- [ ] **Step 1: Write failing unit test**

`packages/assets/src/pexels.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchPhotos } from "./pexels";

describe("searchPhotos", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls Pexels /v1/search with the query and returns normalized results", async () => {
    const fakeRes = {
      photos: [
        { id: 1, src: { large: "https://img.pexels.com/1-large.jpg", medium: "https://img.pexels.com/1-med.jpg" }, alt: "money" },
        { id: 2, src: { large: "https://img.pexels.com/2-large.jpg", medium: "https://img.pexels.com/2-med.jpg" }, alt: "chart" },
      ],
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(fakeRes), { status: 200 })
    );

    const results = await searchPhotos("money", { apiKey: "test-key", perPage: 2 });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const url = fetchSpy.mock.calls[0]?.[0] as string;
    expect(url).toContain("query=money");
    expect(url).toContain("per_page=2");
    expect(results).toEqual([
      { id: 1, thumb: "https://img.pexels.com/1-med.jpg", full: "https://img.pexels.com/1-large.jpg", alt: "money" },
      { id: 2, thumb: "https://img.pexels.com/2-med.jpg", full: "https://img.pexels.com/2-large.jpg", alt: "chart" },
    ]);
  });

  it("throws a clear error on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 401 }));
    await expect(searchPhotos("x", { apiKey: "bad" })).rejects.toThrow(/Pexels 401/);
  });
});
```

- [ ] **Step 2: Run test to see it fail**

First install vitest deps at root: `pnpm add -w -D vitest`

Create root `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    globals: false,
    environment: "node",
  },
});
```

Run: `pnpm vitest run packages/assets/src/pexels.test.ts`
Expected: FAIL with "Cannot find module './pexels'".

- [ ] **Step 3: Implement minimal `packages/assets/src/pexels.ts`**

```ts
export type PexelsPhotoResult = {
  id: number;
  thumb: string;
  full: string;
  alt: string;
};

export async function searchPhotos(
  query: string,
  opts: { apiKey: string; perPage?: number }
): Promise<PexelsPhotoResult[]> {
  const perPage = opts.perPage ?? 5;
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}`;
  const res = await fetch(url, { headers: { Authorization: opts.apiKey } });
  if (!res.ok) {
    throw new Error(`Pexels ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { photos: Array<{ id: number; src: { large: string; medium: string }; alt?: string }> };
  return data.photos.map((p) => ({
    id: p.id,
    thumb: p.src.medium,
    full: p.src.large,
    alt: p.alt ?? "",
  }));
}
```

- [ ] **Step 4: Re-export from index**

`packages/assets/src/index.ts`:
```ts
export * from "./pexels";
```

- [ ] **Step 5: Run test to see it pass**

Run: `pnpm vitest run packages/assets/src/pexels.test.ts`
Expected: 2 tests pass.

- [ ] **Step 6: Create `scripts/smoke/pexels-hello.ts`**

```ts
import "dotenv/config";
import { searchPhotos } from "../../packages/assets/src/pexels";

const apiKey = process.env.PEXELS_API_KEY;
if (!apiKey) {
  console.error("FAIL: PEXELS_API_KEY missing");
  process.exit(1);
}

async function main() {
  const t0 = Date.now();
  const results = await searchPhotos("compound interest", { apiKey, perPage: 5 });
  console.log(`got ${results.length} results in ${Date.now() - t0}ms`);
  for (const r of results) console.log(`  ${r.id}: ${r.alt} — ${r.thumb}`);
  if (results.length === 0) {
    console.error("FAIL: 0 results — check API key or query");
    process.exit(1);
  }
  console.log("OK: pexels-hello passed");
}
main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
```

- [ ] **Step 7: Run smoke**

Run: `pnpm smoke:pexels`
Expected: prints 5 results with thumb URLs, exits 0.

- [ ] **Step 8: Commit**

```bash
git add packages/assets scripts/smoke/pexels-hello.ts vitest.config.ts package.json pnpm-lock.yaml
git commit -m "feat(assets): minimal Pexels client + smoke"
```

---

## Task 9: Piper TTS install + piper-hello smoke

**Files:**
- Create: `scripts/setup/install-piper.sh`
- Create: `packages/tts/src/piper.ts`
- Create: `packages/tts/src/piper.test.ts`
- Create: `packages/tts/src/index.ts`
- Create: `scripts/smoke/piper-hello.ts`

- [ ] **Step 1: Create `scripts/setup/install-piper.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "==> Installing Piper TTS via Homebrew..."
if ! command -v piper >/dev/null 2>&1; then
  brew install piper-tts
else
  echo "    piper already installed"
fi

VOICES_DIR="assets/voices"
mkdir -p "$VOICES_DIR"

download_voice() {
  local name="$1"
  local onnx_url="$2"
  local json_url="$3"
  if [ -f "$VOICES_DIR/$name.onnx" ]; then
    echo "    $name already downloaded"
    return
  fi
  echo "==> Downloading $name..."
  curl -L -o "$VOICES_DIR/$name.onnx" "$onnx_url"
  curl -L -o "$VOICES_DIR/$name.onnx.json" "$json_url"
}

# Ryan (male, authoritative)
download_voice "en_US-ryan-high" \
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high/en_US-ryan-high.onnx" \
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high/en_US-ryan-high.onnx.json"

# Amy (female, clear)
download_voice "en_US-amy-medium" \
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx" \
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json"

echo "==> Piper setup complete. Voices in $VOICES_DIR"
ls -la "$VOICES_DIR"
```

Make it executable: `chmod +x scripts/setup/install-piper.sh`

- [ ] **Step 2: Run the setup**

This is a one-time setup the agent should run if not already done.
Run: `pnpm setup:piper`
Expected: piper installed (or already-installed message), both `.onnx` + `.onnx.json` files in `assets/voices/`.

Sanity-check: `piper --help` exits 0 and prints usage.

- [ ] **Step 3: Write failing unit test for piper wrapper**

`packages/tts/src/piper.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { buildPiperArgs } from "./piper";

describe("buildPiperArgs", () => {
  it("constructs the expected argv", () => {
    const args = buildPiperArgs({
      modelPath: "/abs/assets/voices/en_US-ryan-high.onnx",
      outputPath: "/abs/output/x/audio.wav",
    });
    expect(args).toEqual(["--model", "/abs/assets/voices/en_US-ryan-high.onnx", "--output_file", "/abs/output/x/audio.wav"]);
  });
});
```

- [ ] **Step 4: Run test to see it fail**

Run: `pnpm vitest run packages/tts/src/piper.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `packages/tts/src/piper.ts`**

```ts
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";

export type PiperOpts = { modelPath: string; outputPath: string };

export function buildPiperArgs(opts: PiperOpts): string[] {
  return ["--model", opts.modelPath, "--output_file", opts.outputPath];
}

export async function synthesize(text: string, opts: PiperOpts): Promise<{ outputPath: string; durationMs: number }> {
  const t0 = Date.now();
  await fs.mkdir(opts.outputPath.split("/").slice(0, -1).join("/"), { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("piper", buildPiperArgs(opts));
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`piper exited ${code}: ${stderr}`));
    });
    proc.stdin.end(text);
  });

  return { outputPath: opts.outputPath, durationMs: Date.now() - t0 };
}
```

- [ ] **Step 6: Re-export from index**

`packages/tts/src/index.ts`:
```ts
export * from "./piper";
```

- [ ] **Step 7: Run test to see it pass**

Run: `pnpm vitest run packages/tts/src/piper.test.ts`
Expected: 1 test passes.

- [ ] **Step 8: Create `scripts/smoke/piper-hello.ts`**

```ts
import { synthesize } from "../../packages/tts/src/piper";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";

const MODEL = resolve("assets/voices/en_US-ryan-high.onnx");
const OUT = resolve("output/_smoke/piper-hello.wav");

async function main() {
  await fs.mkdir("output/_smoke", { recursive: true });
  const t0 = Date.now();
  await synthesize("This is a Piper text to speech smoke test.", { modelPath: MODEL, outputPath: OUT });
  const stat = await fs.stat(OUT);
  console.log(`wrote ${OUT} (${stat.size} bytes) in ${Date.now() - t0}ms`);
  if (stat.size < 5000) {
    console.error("FAIL: wav too small");
    process.exit(1);
  }
  console.log("OK: piper-hello passed");
}
main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
```

- [ ] **Step 9: Run smoke**

Run: `pnpm smoke:piper`
Expected: `output/_smoke/piper-hello.wav` exists, >5KB, smoke passes.

- [ ] **Step 10: Commit**

```bash
git add scripts/setup/install-piper.sh packages/tts scripts/smoke/piper-hello.ts package.json pnpm-lock.yaml
git commit -m "feat(tts): piper installer + wrapper + smoke"
```

---

## Task 10: whisper.cpp install + whisper-hello smoke

**Files:**
- Create: `scripts/setup/install-whisper.sh`
- Create: `packages/captions/src/whisper.ts`
- Create: `packages/captions/src/whisper.test.ts`
- Create: `packages/captions/src/index.ts`
- Create: `scripts/smoke/whisper-hello.ts`

- [ ] **Step 1: Create `scripts/setup/install-whisper.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "==> Installing whisper-cpp via Homebrew..."
if ! command -v whisper-cpp >/dev/null 2>&1; then
  brew install whisper-cpp
else
  echo "    whisper-cpp already installed"
fi

WHISPER_DIR="assets/whisper"
mkdir -p "$WHISPER_DIR"

MODEL="$WHISPER_DIR/ggml-small.en.bin"
if [ -f "$MODEL" ]; then
  echo "    small.en model already downloaded"
else
  echo "==> Downloading small.en model (~466MB)..."
  curl -L -o "$MODEL" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin"
fi

echo "==> whisper setup complete."
ls -la "$WHISPER_DIR"
```

Make executable: `chmod +x scripts/setup/install-whisper.sh`

- [ ] **Step 2: Run the setup**

Run: `pnpm setup:whisper`
Expected: `whisper-cpp --help` works; `assets/whisper/ggml-small.en.bin` exists ~466MB.

- [ ] **Step 3: Write failing unit test**

`packages/captions/src/whisper.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseWhisperJson } from "./whisper";

describe("parseWhisperJson", () => {
  it("flattens segments into a flat word array with start/end in seconds", () => {
    const fixture = {
      transcription: [
        {
          timestamps: { from: "00:00:00,000", to: "00:00:00,400" },
          offsets: { from: 0, to: 400 },
          text: "Hello",
        },
        {
          timestamps: { from: "00:00:00,400", to: "00:00:00,900" },
          offsets: { from: 400, to: 900 },
          text: "world",
        },
      ],
    };
    const result = parseWhisperJson(fixture);
    expect(result).toEqual({
      words: [
        { word: "Hello", start: 0.0, end: 0.4 },
        { word: "world", start: 0.4, end: 0.9 },
      ],
    });
  });

  it("trims whitespace and skips empty tokens", () => {
    const fixture = {
      transcription: [
        { offsets: { from: 0, to: 100 }, text: " hi " },
        { offsets: { from: 100, to: 200 }, text: "" },
      ],
    };
    const result = parseWhisperJson(fixture);
    expect(result.words).toEqual([{ word: "hi", start: 0.0, end: 0.1 }]);
  });
});
```

- [ ] **Step 4: Run test to see it fail**

Run: `pnpm vitest run packages/captions/src/whisper.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `packages/captions/src/whisper.ts`**

```ts
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";

export type WordTiming = { word: string; start: number; end: number };
export type CaptionsResult = { words: WordTiming[] };

type WhisperSegment = { offsets: { from: number; to: number }; text: string };
type WhisperJson = { transcription: WhisperSegment[] };

export function parseWhisperJson(raw: WhisperJson): CaptionsResult {
  const words: WordTiming[] = [];
  for (const seg of raw.transcription) {
    const trimmed = (seg.text ?? "").trim();
    if (!trimmed) continue;
    words.push({
      word: trimmed,
      start: seg.offsets.from / 1000,
      end: seg.offsets.to / 1000,
    });
  }
  return { words };
}

export async function transcribe(
  audioPath: string,
  opts: { modelPath: string; outputJsonPath: string }
): Promise<CaptionsResult> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("whisper-cpp", [
      "-m", opts.modelPath,
      "--output-json",
      "--max-len", "1",
      "-f", audioPath,
      "-of", opts.outputJsonPath.replace(/\.json$/, ""),
    ]);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`whisper exited ${code}: ${stderr}`))));
  });

  const raw = JSON.parse(await fs.readFile(opts.outputJsonPath, "utf8")) as WhisperJson;
  return parseWhisperJson(raw);
}
```

- [ ] **Step 6: Re-export from index**

`packages/captions/src/index.ts`:
```ts
export * from "./whisper";
```

- [ ] **Step 7: Run test to see it pass**

Run: `pnpm vitest run packages/captions/src/whisper.test.ts`
Expected: 2 tests pass.

- [ ] **Step 8: Create `scripts/smoke/whisper-hello.ts`**

```ts
import { transcribe } from "../../packages/captions/src/whisper";
import { resolve } from "node:path";
import { promises as fs } from "node:fs";

const MODEL = resolve("assets/whisper/ggml-small.en.bin");
const AUDIO = resolve("output/_smoke/piper-hello.wav");
const OUT = resolve("output/_smoke/whisper-hello.json");

async function main() {
  await fs.access(AUDIO).catch(() => {
    console.error(`FAIL: ${AUDIO} not found. Run 'pnpm smoke:piper' first.`);
    process.exit(1);
  });
  const t0 = Date.now();
  const result = await transcribe(AUDIO, { modelPath: MODEL, outputJsonPath: OUT });
  console.log(`got ${result.words.length} words in ${Date.now() - t0}ms`);
  console.log(result.words.slice(0, 6));
  if (result.words.length < 5) {
    console.error("FAIL: too few words");
    process.exit(1);
  }
  console.log("OK: whisper-hello passed");
}
main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
```

- [ ] **Step 9: Run smoke**

Run: `pnpm smoke:whisper`
Expected: ≥5 words printed with timings, smoke passes. (Requires piper smoke to have run.)

- [ ] **Step 10: Commit**

```bash
git add scripts/setup/install-whisper.sh packages/captions scripts/smoke/whisper-hello.ts package.json pnpm-lock.yaml
git commit -m "feat(captions): whisper installer + wrapper + smoke"
```

---

## Task 11: Remotion scaffold + remotion-hello smoke

**Files:**
- Create: `packages/remotion/package.json`
- Create: `packages/remotion/tsconfig.json`
- Create: `packages/remotion/src/index.ts`
- Create: `packages/remotion/src/Root.tsx`
- Create: `packages/remotion/src/HelloVideo.tsx`
- Create: `scripts/smoke/remotion-hello.ts`

- [ ] **Step 1: Install Remotion**

Run from repo root:
```bash
pnpm add -w remotion @remotion/cli @remotion/bundler
pnpm add -w -D @remotion/renderer
```

- [ ] **Step 2: Create `packages/remotion/package.json`**

```json
{
  "name": "@studio/remotion",
  "version": "0.0.1",
  "private": true,
  "main": "src/index.ts",
  "scripts": {
    "preview": "remotion preview src/index.ts"
  },
  "peerDependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0"
  }
}
```

- [ ] **Step 3: Create `packages/remotion/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Create `packages/remotion/src/HelloVideo.tsx`**

```tsx
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";

export const HelloVideo: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 15, 45, 60], [0, 1, 1, 0]);
  return (
    <AbsoluteFill style={{ backgroundColor: "#0B0F1A", color: "#00FF85", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontFamily: "sans-serif", fontSize: 120, fontWeight: 900, opacity }}>
        PIPELINE OK
      </div>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 5: Create `packages/remotion/src/Root.tsx`**

```tsx
import { Composition } from "remotion";
import { HelloVideo } from "./HelloVideo";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="HelloVideo"
      component={HelloVideo}
      durationInFrames={60}
      fps={30}
      width={1080}
      height={1920}
    />
  </>
);
```

- [ ] **Step 6: Create `packages/remotion/src/index.ts`**

```ts
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);
```

- [ ] **Step 7: Create `scripts/smoke/remotion-hello.ts`**

```ts
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { resolve } from "node:path";
import { promises as fs } from "node:fs";

const ENTRY = resolve("packages/remotion/src/index.ts");
const OUT_DIR = resolve("output/_smoke");
const OUT = resolve(OUT_DIR, "remotion-hello.mp4");

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  console.log("==> bundling...");
  const t0 = Date.now();
  const bundled = await bundle({ entryPoint: ENTRY });
  console.log(`    bundled in ${Date.now() - t0}ms`);

  const composition = await selectComposition({ serveUrl: bundled, id: "HelloVideo" });
  console.log("==> rendering...");
  const t1 = Date.now();
  await renderMedia({
    composition,
    serveUrl: bundled,
    codec: "h264",
    outputLocation: OUT,
  });
  console.log(`    rendered in ${Date.now() - t1}ms`);
  const stat = await fs.stat(OUT);
  console.log(`wrote ${OUT} (${stat.size} bytes)`);
  if (stat.size < 10000) {
    console.error("FAIL: mp4 too small");
    process.exit(1);
  }
  console.log("OK: remotion-hello passed");
}
main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
```

- [ ] **Step 8: Run install + smoke**

Run: `pnpm install`
Run: `pnpm smoke:remotion`
Expected: bundles in ~10s, renders in 5–15s, MP4 written, smoke passes.

- [ ] **Step 9: Commit**

```bash
git add packages/remotion scripts/smoke/remotion-hello.ts package.json pnpm-lock.yaml
git commit -m "feat(remotion): scaffold + hello-video smoke"
```

---

## Task 12: /api/health route + dependency-check helpers

**Files:**
- Create: `apps/studio/lib/deps.ts`
- Create: `apps/studio/lib/deps.test.ts`
- Create: `apps/studio/app/api/health/route.ts`

- [ ] **Step 1: Write failing test for `deps.ts`**

`apps/studio/lib/deps.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { checkBinary, summarize } from "./deps";

describe("checkBinary", () => {
  it("returns ok when which finds the binary", async () => {
    const res = await checkBinary("sh");  // sh exists on every macOS
    expect(res.ok).toBe(true);
    expect(res.path?.length).toBeGreaterThan(0);
  });

  it("returns not ok when binary missing", async () => {
    const res = await checkBinary("definitely-not-a-real-binary-xyz123");
    expect(res.ok).toBe(false);
  });
});

describe("summarize", () => {
  it("returns ok when every entry is ok", () => {
    expect(summarize([{ name: "a", ok: true }, { name: "b", ok: true }])).toBe("ok");
  });
  it("returns degraded when some failures", () => {
    expect(summarize([{ name: "a", ok: true }, { name: "b", ok: false }])).toBe("degraded");
  });
});
```

- [ ] **Step 2: Run test to see it fail**

Run: `pnpm vitest run apps/studio/lib/deps.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/studio/lib/deps.ts`**

```ts
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";

export type DepCheck = { name: string; ok: boolean; path?: string; detail?: string };

export async function checkBinary(name: string): Promise<DepCheck> {
  return new Promise((resolveP) => {
    const proc = spawn("which", [name]);
    let stdout = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.on("close", (code) => {
      const path = stdout.trim();
      resolveP({ name, ok: code === 0 && path.length > 0, path: path || undefined });
    });
    proc.on("error", () => resolveP({ name, ok: false }));
  });
}

export async function checkFile(name: string, path: string): Promise<DepCheck> {
  try {
    const stat = await fs.stat(path);
    return { name, ok: stat.isFile(), path, detail: `${stat.size} bytes` };
  } catch {
    return { name, ok: false, path, detail: "missing" };
  }
}

export async function checkEnv(name: string, key: string, env: NodeJS.ProcessEnv): Promise<DepCheck> {
  const v = env[key];
  return { name, ok: !!v && v.length >= 10, detail: v ? "set" : "missing" };
}

export function summarize(checks: { ok: boolean }[]): "ok" | "degraded" {
  return checks.every((c) => c.ok) ? "ok" : "degraded";
}

export async function runAllChecks(env: NodeJS.ProcessEnv): Promise<{ status: "ok" | "degraded"; checks: DepCheck[] }> {
  const root = process.cwd();
  const checks = await Promise.all([
    checkEnv("ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", env),
    checkEnv("PEXELS_API_KEY", "PEXELS_API_KEY", env),
    checkBinary("piper"),
    checkBinary("whisper-cpp"),
    checkBinary("ffmpeg"),
    checkFile("voice:ryan", resolve(root, "assets/voices/en_US-ryan-high.onnx")),
    checkFile("voice:amy", resolve(root, "assets/voices/en_US-amy-medium.onnx")),
    checkFile("whisper:small.en", resolve(root, "assets/whisper/ggml-small.en.bin")),
  ]);
  return { status: summarize(checks), checks };
}
```

- [ ] **Step 4: Run test to see it pass**

Run: `pnpm vitest run apps/studio/lib/deps.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Create `apps/studio/app/api/health/route.ts`**

```ts
import { NextResponse } from "next/server";
import { runAllChecks } from "@/lib/deps";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await runAllChecks(process.env);
  return NextResponse.json(result);
}
```

- [ ] **Step 6: Verify route**

Run: `pnpm --filter @studio/app dev` (in one terminal)
In another: `curl http://localhost:3000/api/health | jq`
Expected: JSON with `status` and 8 `checks`, all `ok: true` (assuming Tasks 7–10 ran successfully).
Stop dev server.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/lib/deps.ts apps/studio/lib/deps.test.ts apps/studio/app/api/health
git commit -m "feat(studio): /api/health with dependency checks"
```

---

## Task 13: System-status UI page

**Files:**
- Modify: `apps/studio/app/page.tsx`
- Create: `apps/studio/components/system-status.tsx`

- [ ] **Step 1: Create `apps/studio/components/system-status.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Check = { name: string; ok: boolean; path?: string; detail?: string };
type HealthResponse = { status: "ok" | "degraded"; checks: Check[] };

export function SystemStatus() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>System status</CardTitle>
        <div className="flex items-center gap-3">
          {data && (
            <Badge variant={data.status === "ok" ? "success" : "warn"}>{data.status}</Badge>
          )}
          <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
            {loading ? "Checking..." : "Refresh"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!data ? (
          <p className="text-muted-foreground">Loading checks...</p>
        ) : (
          <ul className="space-y-2">
            {data.checks.map((c) => (
              <li key={c.name} className="flex items-center justify-between border-b border-border py-2">
                <div>
                  <div className="font-medium">{c.name}</div>
                  {c.path && <div className="text-xs text-muted-foreground">{c.path}</div>}
                </div>
                <Badge variant={c.ok ? "success" : "error"}>{c.ok ? "ok" : (c.detail ?? "missing")}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Update `apps/studio/app/page.tsx`**

```tsx
import { SystemStatus } from "@/components/system-status";

export default function HomePage() {
  return (
    <main className="max-w-3xl mx-auto p-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Faceless Pipeline</h1>
        <p className="text-muted-foreground mt-1">Local-first studio (Phase 0 scaffold)</p>
      </header>
      <SystemStatus />
    </main>
  );
}
```

- [ ] **Step 3: Verify the page**

Run: `pnpm dev`
Visit `http://localhost:3000`. Expected: status card shows 8 checks, all green if Tasks 7–10 completed. Refresh button works.
Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add apps/studio/app/page.tsx apps/studio/components/system-status.tsx
git commit -m "feat(studio): system-status UI on home page"
```

---

## Task 14: Run the full smoke suite end-to-end

**Files:** none (verification task)

- [ ] **Step 1: Run all smokes in sequence**

Run: `pnpm smoke:all`
Expected: all 5 smokes pass back-to-back. If any fail, fix before proceeding.

- [ ] **Step 2: Run the full test suite**

Run: `pnpm test`
Expected: all Vitest tests pass (Pexels: 2, Piper: 1, Whisper: 2, Deps: 4 — total 9 tests).

- [ ] **Step 3: Boot the studio and view status page**

Run: `pnpm dev`
Visit `http://localhost:3000`. Confirm 8 green checks.
Stop with Ctrl-C.

- [ ] **Step 4: Final commit (mark phase complete)**

```bash
git commit --allow-empty -m "chore: Phase 0 complete — all smokes pass, /health green"
```

- [ ] **Step 5: Tag the phase**

```bash
git tag phase-0-complete
git log --oneline
```

Phase 0 is done. The studio app boots; every external dependency (Claude, Pexels, Piper, whisper.cpp, Remotion) is proven to work; the data model is migrated; `/api/health` returns green; the home page shows real-time dep status. We are ready for Phase 1 (book parsing + idea extraction).

---

## Acceptance criteria for Phase 0

1. ✅ `pnpm install` succeeds from a clean clone
2. ✅ `pnpm smoke:all` exits 0
3. ✅ `pnpm test` reports all unit tests green
4. ✅ `pnpm dev` serves a page at `localhost:3000` that shows 8 green checks
5. ✅ `data/studio.db` exists with all 8 tables (Book, Chapter, Idea, Script, Asset, Render, TrendSnapshot, ApiUsage)
6. ✅ `assets/voices/` contains both `en_US-ryan-high.onnx` and `en_US-amy-medium.onnx`
7. ✅ `assets/whisper/ggml-small.en.bin` exists
8. ✅ `output/_smoke/` contains `piper-hello.wav`, `whisper-hello.json`, `remotion-hello.mp4`
9. ✅ `.env.local` is populated and gitignored
10. ✅ All work committed; `phase-0-complete` tag exists

If any of these fail, debug before moving to Phase 1.
