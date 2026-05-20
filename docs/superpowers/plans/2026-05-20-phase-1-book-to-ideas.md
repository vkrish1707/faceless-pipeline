# Phase 1: Book → Chapters → Ideas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the end-to-end PDF → idea-cards flow described in `docs/superpowers/specs/2026-05-20-phase-1-book-to-ideas-design.md`. User uploads a finance PDF, optionally edits chapters, triggers per-chapter Claude extraction, sees idea cards.

**Architecture:** Pure `packages/parsers/` (PDF + heading detection) and `packages/pipeline/` (Claude extract call). Side-effects live in `apps/studio/lib/jobs/` (job runner + handlers) and Next.js API routes. UI is server-rendered chapter list + client-side polling.

**Tech Stack:** Next.js 15 (App Router), Prisma 6 + SQLite, `pdf-parse` (PDF text), `pdf-lib` (fixture generation for tests), `@anthropic-ai/sdk` with ephemeral prompt caching, `zod` (response validation), Vitest.

---

## Prerequisites (already true)

- Phase 0 complete (`phase-0-complete` tag exists)
- `.env.local` has a valid `ANTHROPIC_API_KEY` with credits
- All Phase 0 smokes pass

---

## File map

```
apps/studio/
  app/
    books/
      new/page.tsx                       # upload form
      [id]/
        page.tsx                         # chapter editor (server)
        ChapterEditor.tsx                # client subtree
        chapters/[cid]/page.tsx          # idea cards
    api/
      books/route.ts                     # POST (multipart)
      chapters/[id]/
        route.ts                         # PATCH | DELETE
        split/route.ts                   # POST
        extract/route.ts                 # POST
      jobs/[id]/route.ts                 # GET (poll)
  lib/
    jobs/
      runner.ts                          # generic runJob, orphan recovery
      runner.test.ts
      handlers/
        extract-ideas.ts                 # this phase's only handler
        extract-ideas.test.ts            # integration
      types.ts                           # JobType union, payload types
    storage.ts                           # writePdfFile, pdfPathFor
  instrumentation.ts                     # call recoverOrphans on startup
  prisma/
    schema.prisma                        # add Job + Idea fields
    migrations/<ts>_phase1/               # generated

packages/parsers/
  src/
    pdf.ts
    pdf.test.ts
    chapters.ts
    chapters.test.ts
    fixtures.ts                          # pdf-lib helpers, test-only
    index.ts                             # re-exports
  package.json                           # add pdf-parse + pdf-lib deps

packages/pipeline/
  src/
    extract.ts
    extract.test.ts
    schemas.ts                           # zod schemas
    prompts.ts                           # SYSTEM_PROMPT + USER_PROMPT
    index.ts                             # re-exports
  package.json                           # add @anthropic-ai/sdk + zod

scripts/smoke/
  phase1-hello.ts                        # real PDF + real Claude call
```

---

## Task 1: Migrate database — add Job table, extend Idea

**Files:**
- Modify: `apps/studio/prisma/schema.prisma`
- Create: `apps/studio/prisma/migrations/<ts>_phase1/migration.sql` (generated)

- [ ] **Step 1: Add Job model + Idea fields to schema**

Append to `apps/studio/prisma/schema.prisma`:

```prisma
model Job {
  id          String    @id @default(cuid())
  type        String
  status      String
  progress    Int       @default(0)
  error       String?
  targetType  String
  targetId    String
  payload     Json?
  result      Json?
  startedAt   DateTime?
  completedAt DateTime?
  createdAt   DateTime  @default(now())

  @@index([targetType, targetId, type])
  @@index([status])
}
```

In the existing `Idea` model, add two fields (just before `script Script?`):

```prisma
  sourceQuotes    Json?
  candidateHooks  Json?
```

- [ ] **Step 2: Run migration**

Run from repo root: `pnpm db:migrate --name phase1`
Expected: a new migration directory under `apps/studio/prisma/migrations/` is created and applied; Prisma Client regenerates.

- [ ] **Step 3: Verify schema is live**

Create a temp file `apps/studio/lib/__db-check2.ts`:

```ts
import { db } from "./db";

async function main() {
  await db.$queryRaw`SELECT 1 FROM Job LIMIT 0`;
  await db.$queryRaw`SELECT sourceQuotes, candidateHooks FROM Idea LIMIT 0`;
  console.log("OK: Job table + Idea fields exist");
  await db.$disconnect();
}
main();
```

Run: `pnpm --filter @studio/app exec tsx lib/__db-check2.ts`
Expected: prints `OK: Job table + Idea fields exist`.

Delete the temp file: `rm apps/studio/lib/__db-check2.ts`

- [ ] **Step 4: Commit**

```bash
git add apps/studio/prisma
git commit -m "feat(db): add Job table + extend Idea with sourceQuotes/candidateHooks

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: parsers — `parsePdf`

**Files:**
- Modify: `packages/parsers/package.json` (add deps)
- Create: `packages/parsers/src/fixtures.ts`
- Create: `packages/parsers/src/pdf.test.ts`
- Create: `packages/parsers/src/pdf.ts`
- Modify: `packages/parsers/src/index.ts`

- [ ] **Step 1: Install deps**

From repo root:
```bash
pnpm --filter @studio/parsers add pdf-parse
pnpm --filter @studio/parsers add -D pdf-lib @types/node
```

Note on `pdf-parse`: its package entry runs a debug script that opens a hard-coded test PDF. Always import from the deep path: `import pdf from "pdf-parse/lib/pdf-parse.js"`.

- [ ] **Step 2: Create fixture helper**

`packages/parsers/src/fixtures.ts`:

```ts
import { PDFDocument, StandardFonts } from "pdf-lib";

export async function makeFixturePdf(pages: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([612, 792]);
    const lines = text.split("\n");
    let y = 750;
    for (const line of lines) {
      page.drawText(line, { x: 50, y, size: 12, font });
      y -= 16;
    }
  }
  return Buffer.from(await doc.save());
}
```

- [ ] **Step 3: Write failing test**

`packages/parsers/src/pdf.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parsePdf } from "./pdf";
import { makeFixturePdf } from "./fixtures";

describe("parsePdf", () => {
  it("returns page count and per-page text in order", async () => {
    const buf = await makeFixturePdf(["Hello page one", "Page two body", "Final third page"]);
    const result = await parsePdf(buf);
    expect(result.pageCount).toBe(3);
    expect(result.pages).toHaveLength(3);
    expect(result.pages[0]).toContain("Hello page one");
    expect(result.pages[1]).toContain("Page two body");
    expect(result.pages[2]).toContain("Final third page");
  });

  it("throws PdfParseError on non-PDF input", async () => {
    await expect(parsePdf(Buffer.from("not a pdf"))).rejects.toThrow(/PdfParseError/);
  });
});
```

- [ ] **Step 4: Run test — expect failure**

```bash
pnpm vitest run packages/parsers/src/pdf.test.ts
```
Expected: FAIL — `./pdf` module not found.

- [ ] **Step 5: Implement `parsePdf`**

`packages/parsers/src/pdf.ts`:

```ts
// pdf-parse's index.js opens a hard-coded debug PDF; use the deep import to avoid it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
  buffer: Buffer,
  opts?: Record<string, unknown>
) => Promise<{ numpages: number; text: string }>;

export class PdfParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfParseError";
  }
}

export type ParsedPdf = { pageCount: number; pages: string[] };

export async function parsePdf(buffer: Buffer): Promise<ParsedPdf> {
  const pages: string[] = [];

  // pagerender lets us capture per-page text instead of one concatenated string.
  // The function receives a pdfjs PageProxy and should return a Promise<string>.
  const pagerender = async (pageData: {
    getTextContent: (opts: { normalizeWhitespace: boolean }) => Promise<{
      items: Array<{ str: string; transform: number[] }>;
    }>;
  }): Promise<string> => {
    const tc = await pageData.getTextContent({ normalizeWhitespace: true });
    // Re-flow lines using the y-coordinate (transform[5]) so word order is preserved.
    let lastY: number | null = null;
    let out = "";
    for (const item of tc.items) {
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) out += "\n";
      out += item.str + " ";
      lastY = y;
    }
    pages.push(out.trim());
    return out;
  };

  try {
    const result = await pdfParse(buffer, { pagerender });
    return { pageCount: result.numpages, pages };
  } catch (e) {
    throw new PdfParseError(e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Step 6: Re-export from index**

Replace `packages/parsers/src/index.ts` contents with:

```ts
export * from "./pdf";
```

- [ ] **Step 7: Run test — expect pass**

```bash
pnpm vitest run packages/parsers/src/pdf.test.ts
```
Expected: 2 tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/parsers package.json pnpm-lock.yaml
git commit -m "feat(parsers): parsePdf with per-page text extraction

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: parsers — `detectChapters`

**Files:**
- Create: `packages/parsers/src/chapters.test.ts`
- Create: `packages/parsers/src/chapters.ts`
- Modify: `packages/parsers/src/index.ts`

- [ ] **Step 1: Write failing tests**

`packages/parsers/src/chapters.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { detectChapters, NoChaptersDetectedError } from "./chapters";

describe("detectChapters — regex heading detection", () => {
  it("splits on 'Chapter N' headings (case-insensitive)", () => {
    const pages = [
      "Front matter intro.\n\nChapter 1\nThe Power of Compound Interest\n\nbody body body of chapter one. more text. more text.",
      "still chapter one. more.\n\nCHAPTER 2\nIndex Funds\n\nbody of chapter two. another paragraph. more.",
      "Chapter 3\nAsset Allocation\n\nbody of chapter three. text text text. final words.",
    ];
    const result = detectChapters(pages);
    expect(result).toHaveLength(3);
    expect(result[0]!.title).toMatch(/Compound Interest/i);
    expect(result[0]!.orderIndex).toBe(0);
    expect(result[0]!.startPage).toBe(0);
    expect(result[1]!.title).toMatch(/Index Funds/i);
    expect(result[1]!.orderIndex).toBe(1);
    expect(result[1]!.startPage).toBe(1);
    expect(result[2]!.title).toMatch(/Asset Allocation/i);
    expect(result[2]!.orderIndex).toBe(2);
    expect(result[2]!.startPage).toBe(2);
  });

  it("handles 'Part N' and Roman numerals", () => {
    const pages = [
      "Part 1\nOpening\n\nintro text.\n\nII.\nSecond Section\n\nbody body body body body.",
    ];
    const result = detectChapters(pages);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });
});

describe("detectChapters — typography fallback", () => {
  it("uses short Title-Case lines surrounded by blank lines when no regex matches", () => {
    const pages = [
      "The Opening Section\n\nIntroductory body text that is much longer than the heading itself so this looks like a real chapter.\n\nA Second Heading\n\nMore body text continuing here with enough material to make this a real chapter body that fills a reasonable chunk.",
    ];
    const result = detectChapters(pages);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]!.title).toBe("The Opening Section");
    expect(result[1]!.title).toBe("A Second Heading");
  });
});

describe("detectChapters — word-block fallback", () => {
  it("splits into ~4000-word blocks if nothing else matches", () => {
    const word = "word ";
    const longText = word.repeat(9000);
    const result = detectChapters([longText], { minBlockWords: 4000 });
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]!.title).toMatch(/^Section\s+1$/);
  });

  it("throws NoChaptersDetectedError when input is too small", () => {
    expect(() => detectChapters(["tiny content"])).toThrow(NoChaptersDetectedError);
  });
});

describe("detectChapters — TOC stripping", () => {
  it("drops early Chapter-N occurrences if titles repeat later", () => {
    const pages = [
      // TOC
      "Contents\n\nChapter 1 The Hook\nChapter 2 The Body\nChapter 3 The End",
      // Real chapter 1
      "Chapter 1\nThe Hook\n\nthis is the actual chapter one body with enough text to count as a real chapter body.",
      // Real chapter 2
      "Chapter 2\nThe Body\n\nthis is the actual chapter two body with enough text to count as a real chapter body.",
      // Real chapter 3
      "Chapter 3\nThe End\n\nthis is the actual chapter three body with enough text to count as a real chapter body.",
    ];
    const result = detectChapters(pages);
    expect(result).toHaveLength(3);
    expect(result[0]!.startPage).toBe(1); // Not page 0 (TOC was dropped)
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
pnpm vitest run packages/parsers/src/chapters.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `chapters.ts`**

`packages/parsers/src/chapters.ts`:

```ts
export type Chapter = {
  title: string;
  orderIndex: number;
  startPage: number;
  endPage: number;
  rawText: string;
};

export class NoChaptersDetectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoChaptersDetectedError";
  }
}

const HEADING_REGEX = /^(chapter\s+\d+|ch\.\s*\d+|part\s+\d+|[ivx]{1,5}\.?)(\s|$)/i;
const MIN_TOTAL_WORDS = 1000;
const DEFAULT_MIN_BLOCK_WORDS = 4000;

type RawMatch = { pageIndex: number; lineIndex: number; title: string };

function joinPagesWithMarkers(pages: string[]): { text: string; pageStarts: number[] } {
  const pageStarts: number[] = [];
  let text = "";
  for (let i = 0; i < pages.length; i++) {
    pageStarts.push(text.length);
    text += pages[i] + "\n\n";
  }
  return { text, pageStarts };
}

function offsetToPage(offset: number, pageStarts: number[]): number {
  for (let i = pageStarts.length - 1; i >= 0; i--) {
    if (offset >= pageStarts[i]!) return i;
  }
  return 0;
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function tryRegexHeadings(pages: string[]): Chapter[] | null {
  const matches: RawMatch[] = [];
  for (let p = 0; p < pages.length; p++) {
    const lines = pages[p]!.split("\n");
    for (let l = 0; l < lines.length; l++) {
      if (HEADING_REGEX.test(lines[l]!.trim())) {
        // Use the *next non-empty* line as title if present, else the heading itself.
        let title = lines[l]!.trim();
        for (let k = l + 1; k < Math.min(lines.length, l + 3); k++) {
          const t = lines[k]!.trim();
          if (t && !/^\s*$/.test(t)) {
            title = t;
            break;
          }
        }
        matches.push({ pageIndex: p, lineIndex: l, title });
      }
    }
  }
  if (matches.length < 2) return null;
  return buildChaptersFromMatches(pages, matches);
}

function buildChaptersFromMatches(pages: string[], matches: RawMatch[]): Chapter[] {
  // Drop TOC-style repeats: if a title appears at <5% of total pages AND again later, drop the early one.
  const pageCount = pages.length;
  const earlyCutoff = Math.max(1, Math.floor(pageCount * 0.05));
  const seenTitles = new Map<string, number>(); // normalized title -> first idx in matches
  const dropIndices = new Set<number>();
  for (let i = 0; i < matches.length; i++) {
    const key = matches[i]!.title.toLowerCase();
    if (matches[i]!.pageIndex < earlyCutoff) {
      seenTitles.set(key, i);
    } else if (seenTitles.has(key)) {
      dropIndices.add(seenTitles.get(key)!);
    }
  }
  const kept = matches.filter((_, i) => !dropIndices.has(i));
  if (kept.length < 2) return [];

  const chapters: Chapter[] = [];
  for (let i = 0; i < kept.length; i++) {
    const start = kept[i]!;
    const end = kept[i + 1];
    const startPage = start.pageIndex;
    const endPage = end ? end.pageIndex : pages.length - 1;
    let rawText: string;
    if (!end) {
      rawText = pages.slice(startPage, endPage + 1).join("\n\n");
    } else if (startPage === end.pageIndex) {
      rawText = pages[startPage]!;
    } else {
      rawText = pages.slice(startPage, end.pageIndex).join("\n\n");
    }
    chapters.push({
      title: start.title,
      orderIndex: i,
      startPage,
      endPage,
      rawText,
    });
  }
  return chapters;
}

function tryTypographyHeadings(pages: string[]): Chapter[] | null {
  const matches: RawMatch[] = [];
  for (let p = 0; p < pages.length; p++) {
    const blocks = pages[p]!.split(/\n\s*\n/);
    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;
      const lines = trimmed.split("\n");
      if (lines.length !== 1) continue;
      const line = lines[0]!.trim();
      const words = line.split(/\s+/).filter(Boolean);
      if (words.length === 0 || words.length > 8) continue;
      const isTitleCase = words.every((w) => /^[A-Z]/.test(w) || /^(of|the|and|a|an|in|on|to|for|with)$/i.test(w));
      const isAllCaps = line === line.toUpperCase() && /[A-Z]/.test(line);
      if (!isTitleCase && !isAllCaps) continue;
      // crude: locate the line within the page
      const lineIndex = pages[p]!.indexOf(line);
      matches.push({ pageIndex: p, lineIndex, title: line });
    }
  }
  if (matches.length < 2) return null;
  return buildChaptersFromMatches(pages, matches);
}

function wordBlockFallback(pages: string[], minBlockWords: number): Chapter[] {
  const { text } = joinPagesWithMarkers(pages);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < MIN_TOTAL_WORDS) {
    throw new NoChaptersDetectedError(`Document too small: ${words.length} words (need ${MIN_TOTAL_WORDS}).`);
  }
  const blocks: string[] = [];
  for (let i = 0; i < words.length; i += minBlockWords) {
    blocks.push(words.slice(i, i + minBlockWords).join(" "));
  }
  if (blocks.length < 2) {
    // Force at least 2 blocks by halving
    const half = Math.ceil(words.length / 2);
    return [
      { title: "Section 1", orderIndex: 0, startPage: 0, endPage: Math.floor(pages.length / 2), rawText: words.slice(0, half).join(" ") },
      { title: "Section 2", orderIndex: 1, startPage: Math.floor(pages.length / 2), endPage: pages.length - 1, rawText: words.slice(half).join(" ") },
    ];
  }
  return blocks.map((rawText, i) => ({
    title: `Section ${i + 1}`,
    orderIndex: i,
    startPage: Math.floor((i / blocks.length) * pages.length),
    endPage: Math.floor(((i + 1) / blocks.length) * pages.length) - 1,
    rawText,
  }));
}

export function detectChapters(
  pages: string[],
  opts: { minBlockWords?: number } = {}
): Chapter[] {
  const minBlockWords = opts.minBlockWords ?? DEFAULT_MIN_BLOCK_WORDS;
  return (
    tryRegexHeadings(pages) ??
    tryTypographyHeadings(pages) ??
    wordBlockFallback(pages, minBlockWords)
  );
}
```

- [ ] **Step 4: Update index re-exports**

Replace `packages/parsers/src/index.ts` contents with:

```ts
export * from "./pdf";
export * from "./chapters";
```

- [ ] **Step 5: Run tests — expect pass**

```bash
pnpm vitest run packages/parsers/src/chapters.test.ts
```
Expected: all 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/parsers/src
git commit -m "feat(parsers): detectChapters with regex/typography/word-block fallbacks + TOC stripping

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: pipeline — `extractIdeas`

**Files:**
- Modify: `packages/pipeline/package.json` (add deps)
- Create: `packages/pipeline/src/schemas.ts`
- Create: `packages/pipeline/src/prompts.ts`
- Create: `packages/pipeline/src/extract.test.ts`
- Create: `packages/pipeline/src/extract.ts`
- Modify: `packages/pipeline/src/index.ts`

- [ ] **Step 1: Install deps**

From repo root:
```bash
pnpm --filter @studio/pipeline add @anthropic-ai/sdk zod
```

- [ ] **Step 2: Create zod schemas**

`packages/pipeline/src/schemas.ts`:

```ts
import { z } from "zod";

export const IdeaSchema = z.object({
  title: z.string().min(3).max(120),
  summary: z.string().min(10).max(400),
  targetLengthSec: z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(90)]),
  sourceQuotes: z.array(z.string()).min(1).max(5),
  candidateHooks: z.array(z.string()).min(2).max(3),
});

export const ExtractResponseSchema = z.object({
  ideas: z.array(IdeaSchema).min(1).max(10),
});

export type ExtractedIdea = z.infer<typeof IdeaSchema>;
export type ExtractResponse = z.infer<typeof ExtractResponseSchema>;
```

- [ ] **Step 3: Create prompts**

`packages/pipeline/src/prompts.ts`:

```ts
export const SYSTEM_PROMPT = `You are an expert short-form video producer for finance and personal-development content.

Given the text of one chapter of a non-fiction book, extract 3-8 distinct, hook-driven video ideas.

Each idea MUST be:
- Standalone (no prior context needed from a viewer)
- Built around ONE concrete claim or number from the chapter
- Suitable for a 15-90 second faceless video with on-screen text and b-roll

Reply with VALID JSON ONLY matching this exact schema:

{
  "ideas": [
    {
      "title": "<7-12 words, hook-like, no clickbait fluff>",
      "summary": "<1-2 sentences explaining the idea>",
      "targetLengthSec": 15 | 30 | 60 | 90,
      "sourceQuotes": ["<exact phrase from the chapter>", ...],
      "candidateHooks": ["<alt first-line 1>", "<alt first-line 2>"]
    }
  ]
}

Constraints:
- 3-8 ideas total
- targetLengthSec must be exactly 15, 30, 60, or 90
- 1-5 sourceQuotes per idea — each must be an EXACT substring of the chapter
- 2-3 candidateHooks per idea — each is a punchy first line, NOT a question

Do not include any prose outside the JSON object.`;

export const USER_PROMPT = `Extract video ideas from this chapter. Reply with JSON only.`;
```

- [ ] **Step 4: Write failing tests**

`packages/pipeline/src/extract.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractIdeas } from "./extract";

type Anthropic = typeof import("@anthropic-ai/sdk").default;

function mockSdk(responses: Array<{ status?: number; body?: unknown; error?: Error }>) {
  const createMock = vi.fn();
  for (const r of responses) {
    if (r.error) createMock.mockRejectedValueOnce(r.error);
    else createMock.mockResolvedValueOnce(r.body);
  }
  vi.doMock("@anthropic-ai/sdk", () => {
    return {
      default: class {
        messages = { create: createMock };
      },
    };
  });
  return createMock;
}

const GOOD_RESPONSE = {
  content: [
    {
      type: "text",
      text: JSON.stringify({
        ideas: [
          {
            title: "Compound interest is unforgivingly fast",
            summary: "Small early contributions outperform large late ones because of doubling time.",
            targetLengthSec: 30,
            sourceQuotes: ["compound interest is the eighth wonder of the world"],
            candidateHooks: ["Your future self begs you to start now.", "One dollar at 25 beats ten at 45."],
          },
        ],
      }),
    },
  ],
  usage: { input_tokens: 1500, output_tokens: 200, cache_creation_input_tokens: 1200, cache_read_input_tokens: 0 },
};

describe("extractIdeas", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns parsed ideas + usage on happy path", async () => {
    mockSdk([{ body: GOOD_RESPONSE }]);
    const result = await extractIdeas({
      chapterText: "a".repeat(2000),
      apiKey: "test-key",
    });
    expect(result.ideas).toHaveLength(1);
    expect(result.ideas[0]!.title).toMatch(/compound/i);
    expect(result.usage.inputTokens).toBe(1500);
    expect(result.usage.cacheCreationTokens).toBe(1200);
  });

  it("retries on 429 then succeeds", async () => {
    const err = Object.assign(new Error("rate limit"), { status: 429 });
    const createMock = mockSdk([{ error: err }, { body: GOOD_RESPONSE }]);
    const result = await extractIdeas({
      chapterText: "a".repeat(2000),
      apiKey: "test-key",
    });
    expect(result.ideas).toHaveLength(1);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("throws after 3 attempts on persistent 5xx", async () => {
    const err = Object.assign(new Error("server error"), { status: 503 });
    mockSdk([{ error: err }, { error: err }, { error: err }]);
    await expect(
      extractIdeas({ chapterText: "a".repeat(2000), apiKey: "test-key" })
    ).rejects.toThrow();
  });

  it("throws on malformed JSON in Claude response", async () => {
    mockSdk([
      {
        body: {
          content: [{ type: "text", text: "not json at all" }],
          usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
      { body: { content: [{ type: "text", text: "still not json" }], usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
      { body: { content: [{ type: "text", text: "nope" }], usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
    ]);
    await expect(
      extractIdeas({ chapterText: "a".repeat(2000), apiKey: "test-key" })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 5: Run tests — expect failure**

```bash
pnpm vitest run packages/pipeline/src/extract.test.ts
```
Expected: FAIL — `./extract` module not found.

- [ ] **Step 6: Implement `extract.ts`**

`packages/pipeline/src/extract.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { ExtractResponseSchema, type ExtractedIdea } from "./schemas";
import { SYSTEM_PROMPT, USER_PROMPT } from "./prompts";

export type ExtractUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
};

export type ExtractResult = {
  ideas: ExtractedIdea[];
  usage: ExtractUsage;
};

export type ExtractOpts = {
  chapterText: string;
  apiKey: string;
  model?: string;
  maxAttempts?: number;
};

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_ATTEMPTS = 3;

function isRetryable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: number }).status;
  if (status === undefined) return true; // network/unknown
  return status === 429 || (status >= 500 && status < 600);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function extractIdeas(opts: ExtractOpts): Promise<ExtractResult> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const model = opts.model ?? DEFAULT_MODEL;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await client.messages.create({
        model,
        max_tokens: 2048,
        system: [
          { type: "text", text: SYSTEM_PROMPT },
          { type: "text", text: opts.chapterText, cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: USER_PROMPT }],
      });

      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`Claude returned invalid JSON: ${text.slice(0, 200)}`);
      }

      const validated = ExtractResponseSchema.parse(parsed);

      const usage: ExtractUsage = {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheCreationTokens: (res.usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? 0,
        cacheReadTokens: (res.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0,
      };

      return { ideas: validated.ideas, usage };
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts && isRetryable(err)) {
        await sleep(2 ** (attempt - 1) * 500);
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("extractIdeas: exhausted attempts");
}
```

- [ ] **Step 7: Update index re-exports**

Replace `packages/pipeline/src/index.ts` contents with:

```ts
export * from "./extract";
export * from "./schemas";
```

- [ ] **Step 8: Run tests — expect pass**

```bash
pnpm vitest run packages/pipeline/src/extract.test.ts
```
Expected: 4 tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/pipeline package.json pnpm-lock.yaml
git commit -m "feat(pipeline): extractIdeas with prompt caching + zod validation + retries

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Storage helper for uploaded PDFs

**Files:**
- Create: `apps/studio/lib/storage.ts`

- [ ] **Step 1: Create the helper**

`apps/studio/lib/storage.ts`:

```ts
import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

function workspaceRoot(): string {
  let dir = process.cwd();
  while (dir !== "/") {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

export function pdfPathFor(bookId: string): string {
  return resolve(workspaceRoot(), "assets/pdfs", `${bookId}.pdf`);
}

export async function writePdfFile(bookId: string, buffer: Buffer): Promise<string> {
  const path = pdfPathFor(bookId);
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, buffer);
  return path;
}

export async function deletePdfFile(bookId: string): Promise<void> {
  const path = pdfPathFor(bookId);
  try {
    await fs.unlink(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}
```

- [ ] **Step 2: Update .gitignore for assets/pdfs/**

Edit `.gitignore`, add a new line below `assets/cache/`:

```
assets/pdfs/
```

- [ ] **Step 3: Commit**

```bash
git add apps/studio/lib/storage.ts .gitignore
git commit -m "feat(studio): pdf storage helpers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Job runner + orphan recovery (TDD)

**Files:**
- Create: `apps/studio/lib/jobs/types.ts`
- Create: `apps/studio/lib/jobs/runner.test.ts`
- Create: `apps/studio/lib/jobs/runner.ts`

- [ ] **Step 1: Create job types**

`apps/studio/lib/jobs/types.ts`:

```ts
export type JobType = "extract_ideas";

export type JobStatus = "queued" | "running" | "completed" | "failed";

export type JobHandler<TPayload = unknown, TResult = unknown> = (
  payload: TPayload,
  ctx: { jobId: string; updateProgress: (n: number) => Promise<void> }
) => Promise<TResult>;
```

- [ ] **Step 2: Write failing tests for runner**

`apps/studio/lib/jobs/runner.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../db";
import { recoverOrphans, runJob, registerHandler } from "./runner";

describe("job runner", () => {
  beforeEach(async () => {
    await db.job.deleteMany();
  });

  it("transitions queued → running → completed on success and writes result", async () => {
    registerHandler("extract_ideas", async (_payload, ctx) => {
      await ctx.updateProgress(50);
      return { ok: true };
    });
    const job = await db.job.create({
      data: { type: "extract_ideas", status: "queued", targetType: "Chapter", targetId: "c1" },
    });
    await runJob(job.id);
    const after = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe("completed");
    expect(after.progress).toBe(100);
    expect(after.result).toEqual({ ok: true });
    expect(after.completedAt).not.toBeNull();
  });

  it("transitions to failed on handler throw and writes error", async () => {
    registerHandler("extract_ideas", async () => {
      throw new Error("boom");
    });
    const job = await db.job.create({
      data: { type: "extract_ideas", status: "queued", targetType: "Chapter", targetId: "c2" },
    });
    await runJob(job.id);
    const after = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe("failed");
    expect(after.error).toContain("boom");
  });

  it("recoverOrphans marks running jobs as failed", async () => {
    await db.job.create({
      data: { type: "extract_ideas", status: "running", targetType: "Chapter", targetId: "c3" },
    });
    await db.job.create({
      data: { type: "extract_ideas", status: "queued", targetType: "Chapter", targetId: "c4" },
    });
    const n = await recoverOrphans();
    expect(n).toBe(1);
    const running = await db.job.findMany({ where: { status: "running" } });
    expect(running).toHaveLength(0);
    const failed = await db.job.findMany({ where: { status: "failed" } });
    expect(failed).toHaveLength(1);
    expect(failed[0]!.error).toBe("interrupted");
  });
});
```

- [ ] **Step 3: Run tests — expect failure**

```bash
pnpm vitest run apps/studio/lib/jobs/runner.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 4: Implement runner**

`apps/studio/lib/jobs/runner.ts`:

```ts
import { db } from "../db";
import type { JobHandler, JobType } from "./types";

const handlers = new Map<JobType, JobHandler>();

export function registerHandler<P, R>(type: JobType, handler: JobHandler<P, R>): void {
  handlers.set(type, handler as JobHandler);
}

export async function recoverOrphans(): Promise<number> {
  const res = await db.job.updateMany({
    where: { status: "running" },
    data: { status: "failed", error: "interrupted", completedAt: new Date() },
  });
  return res.count;
}

export async function runJob(jobId: string): Promise<void> {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  const handler = handlers.get(job.type as JobType);
  if (!handler) {
    await db.job.update({
      where: { id: jobId },
      data: { status: "failed", error: `no handler for type ${job.type}`, completedAt: new Date() },
    });
    return;
  }

  await db.job.update({
    where: { id: jobId },
    data: { status: "running", startedAt: new Date(), progress: 10 },
  });

  try {
    const result = await handler(job.payload, {
      jobId,
      updateProgress: async (n: number) => {
        await db.job.update({ where: { id: jobId }, data: { progress: Math.max(0, Math.min(100, n)) } });
      },
    });
    await db.job.update({
      where: { id: jobId },
      data: { status: "completed", progress: 100, completedAt: new Date(), result: result as object | null },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);
    await db.job.update({
      where: { id: jobId },
      data: { status: "failed", error: message, completedAt: new Date() },
    });
  }
}

export function enqueueAndRun(jobId: string): void {
  // Fire-and-forget; errors are persisted by runJob itself.
  runJob(jobId).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[jobs] runJob ${jobId} threw outside handler:`, err);
  });
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
pnpm vitest run apps/studio/lib/jobs/runner.test.ts
```
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/lib/jobs
git commit -m "feat(jobs): generic runner with handler registry + orphan recovery

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `extract_ideas` job handler + integration test

**Files:**
- Create: `apps/studio/lib/jobs/handlers/extract-ideas.ts`
- Create: `apps/studio/lib/jobs/handlers/extract-ideas.test.ts`

- [ ] **Step 1: Write failing integration test**

`apps/studio/lib/jobs/handlers/extract-ideas.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../../db";

// Mock the pipeline so the handler test runs without hitting the network.
vi.mock("@studio/pipeline", () => ({
  extractIdeas: vi.fn(async () => ({
    ideas: [
      {
        title: "Time in the market beats timing the market",
        summary: "Lump-sum data shows holding outperforms trying to time entry points.",
        targetLengthSec: 60,
        sourceQuotes: ["time in the market beats timing the market"],
        candidateHooks: ["Your portfolio's worst enemy is your reflexes.", "The market rewards stillness."],
      },
    ],
    usage: { inputTokens: 1500, outputTokens: 120, cacheCreationTokens: 1200, cacheReadTokens: 0 },
  })),
}));

import { runJob, registerHandler } from "../runner";
import { handleExtractIdeas } from "./extract-ideas";

registerHandler("extract_ideas", handleExtractIdeas);

describe("handleExtractIdeas", () => {
  let bookId: string;
  let chapterId: string;

  beforeEach(async () => {
    await db.apiUsage.deleteMany();
    await db.idea.deleteMany();
    await db.chapter.deleteMany();
    await db.book.deleteMany();
    await db.job.deleteMany();
    const book = await db.book.create({
      data: { title: "Test", filePath: "/tmp/x.pdf", niche: "investing", pageCount: 1, status: "ready" },
    });
    bookId = book.id;
    const chapter = await db.chapter.create({
      data: {
        bookId,
        title: "Chapter 1",
        orderIndex: 0,
        startPage: 0,
        endPage: 0,
        rawText: "time in the market beats timing the market and other wisdom.",
        status: "pending",
      },
    });
    chapterId = chapter.id;
    process.env.ANTHROPIC_API_KEY = "sk-test-1234567890123456";
  });

  it("persists ideas and ApiUsage when run", async () => {
    const job = await db.job.create({
      data: {
        type: "extract_ideas",
        status: "queued",
        targetType: "Chapter",
        targetId: chapterId,
        payload: { chapterId },
      },
    });
    await runJob(job.id);

    const after = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe("completed");

    const ideas = await db.idea.findMany({ where: { chapterId } });
    expect(ideas).toHaveLength(1);
    expect(ideas[0]!.title).toMatch(/timing the market/);
    expect(ideas[0]!.targetLengthSec).toBe(60);

    const usage = await db.apiUsage.findMany();
    expect(usage).toHaveLength(1);
    expect(usage[0]!.tokensIn).toBe(1500);
  });

  it("replaces existing ideas for the chapter on re-run", async () => {
    await db.idea.create({
      data: {
        chapterId,
        title: "old idea",
        summary: "old",
        targetLengthSec: 15,
        status: "draft",
      },
    });

    const job = await db.job.create({
      data: {
        type: "extract_ideas",
        status: "queued",
        targetType: "Chapter",
        targetId: chapterId,
        payload: { chapterId },
      },
    });
    await runJob(job.id);

    const ideas = await db.idea.findMany({ where: { chapterId } });
    expect(ideas).toHaveLength(1);
    expect(ideas[0]!.title).not.toBe("old idea");
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
pnpm vitest run apps/studio/lib/jobs/handlers/extract-ideas.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement handler**

`apps/studio/lib/jobs/handlers/extract-ideas.ts`:

```ts
import { extractIdeas } from "@studio/pipeline";
import { db } from "../../db";
import type { JobHandler } from "../types";

export type ExtractIdeasPayload = { chapterId: string };
export type ExtractIdeasResult = { ideasCreated: number };

export const handleExtractIdeas: JobHandler<ExtractIdeasPayload, ExtractIdeasResult> = async (
  payload,
  ctx
) => {
  const chapter = await db.chapter.findUniqueOrThrow({ where: { id: payload.chapterId } });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  await ctx.updateProgress(20);

  const { ideas, usage } = await extractIdeas({
    chapterText: chapter.rawText,
    apiKey,
  });

  await ctx.updateProgress(80);

  await db.$transaction(async (tx) => {
    await tx.idea.deleteMany({ where: { chapterId: payload.chapterId } });
    for (const i of ideas) {
      await tx.idea.create({
        data: {
          chapterId: payload.chapterId,
          title: i.title,
          summary: i.summary,
          targetLengthSec: i.targetLengthSec,
          sourceQuotes: i.sourceQuotes,
          candidateHooks: i.candidateHooks,
          status: "draft",
        },
      });
    }
    await tx.chapter.update({ where: { id: payload.chapterId }, data: { status: "extracted" } });
    await tx.apiUsage.create({
      data: {
        service: "anthropic",
        endpoint: "messages.create",
        tokensIn: usage.inputTokens,
        tokensOut: usage.outputTokens,
        traceId: ctx.jobId,
      },
    });
  });

  return { ideasCreated: ideas.length };
};
```

- [ ] **Step 4: Add `@studio/pipeline` workspace dep to studio**

Edit `apps/studio/package.json` `dependencies` (alphabetically among `@studio/*` if any):

```json
    "@studio/pipeline": "workspace:*",
```

Run: `pnpm install`
Expected: workspace symlink created.

- [ ] **Step 5: Run tests — expect pass**

```bash
pnpm vitest run apps/studio/lib/jobs/handlers/extract-ideas.test.ts
```
Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/lib/jobs/handlers apps/studio/package.json pnpm-lock.yaml
git commit -m "feat(jobs): extract_ideas handler persists ideas + ApiUsage

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: API route — `POST /api/books`

**Files:**
- Create: `apps/studio/app/api/books/route.ts`

- [ ] **Step 1: Add `@studio/parsers` workspace dep to studio**

Edit `apps/studio/package.json` dependencies, add:

```json
    "@studio/parsers": "workspace:*",
```

Run: `pnpm install`

- [ ] **Step 2: Create the route**

`apps/studio/app/api/books/route.ts`:

```ts
import { NextResponse } from "next/server";
import { parsePdf, detectChapters, PdfParseError, NoChaptersDetectedError } from "@studio/parsers";
import { db } from "@/lib/db";
import { writePdfFile, deletePdfFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

const MAX_SIZE_BYTES = 50 * 1024 * 1024;
const ALLOWED_NICHES = ["personal_finance", "investing", "entrepreneurship", "psychology", "other"];

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  const niche = String(form.get("niche") ?? "");
  const titleOverride = String(form.get("title") ?? "").trim();

  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "file is empty" }, { status: 400 });
  if (file.size > MAX_SIZE_BYTES) return NextResponse.json({ error: "file exceeds 50MB" }, { status: 400 });
  if (!ALLOWED_NICHES.includes(niche)) return NextResponse.json({ error: "invalid niche" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!buffer.slice(0, 5).equals(Buffer.from("%PDF-"))) {
    return NextResponse.json({ error: "not a PDF (missing magic bytes)" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = await parsePdf(buffer);
  } catch (e) {
    const msg = e instanceof PdfParseError ? e.message : "failed to parse PDF";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  let chapters;
  try {
    chapters = detectChapters(parsed.pages);
  } catch (e) {
    if (e instanceof NoChaptersDetectedError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }

  // Derive a default title from filename if not overridden.
  const defaultTitle = file.name.replace(/\.pdf$/i, "").trim() || "Untitled";
  const title = titleOverride || defaultTitle;

  const book = await db.book.create({
    data: { title, filePath: "", niche, pageCount: parsed.pageCount, status: "ready" },
  });

  try {
    const filePath = await writePdfFile(book.id, buffer);
    await db.$transaction(async (tx) => {
      await tx.book.update({ where: { id: book.id }, data: { filePath } });
      for (const c of chapters) {
        await tx.chapter.create({
          data: {
            bookId: book.id,
            title: c.title,
            orderIndex: c.orderIndex,
            startPage: c.startPage,
            endPage: c.endPage,
            rawText: c.rawText,
            status: "pending",
          },
        });
      }
    });
  } catch (e) {
    // Roll back: delete the Book row and any chapters, plus the file on disk.
    await db.chapter.deleteMany({ where: { bookId: book.id } });
    await db.book.delete({ where: { id: book.id } });
    await deletePdfFile(book.id);
    throw e;
  }

  return NextResponse.json({ bookId: book.id, chapterCount: chapters.length });
}
```

- [ ] **Step 3: Verify the route compiles**

```bash
cd apps/studio && pnpm type-check
```
Expected: clean (exit 0).

- [ ] **Step 4: Smoke-test with curl**

In one terminal: `pnpm dev` (from repo root).

In another, create a 2-page fixture PDF using tsx (pdf-lib is ESM-only):

```bash
cat > /tmp/make-fixture.ts <<'TS'
import { PDFDocument, StandardFonts } from "pdf-lib";
import { writeFileSync } from "node:fs";

const bodyText = ("body ").repeat(60);

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);

const p1 = doc.addPage();
p1.drawText("Chapter 1", { x: 50, y: 750, size: 14, font });
p1.drawText("Compound Interest", { x: 50, y: 730, size: 12, font });
p1.drawText(bodyText, { x: 50, y: 700, size: 10, font, maxWidth: 500 });

const p2 = doc.addPage();
p2.drawText("Chapter 2", { x: 50, y: 750, size: 14, font });
p2.drawText("Asset Allocation", { x: 50, y: 730, size: 12, font });
p2.drawText(bodyText, { x: 50, y: 700, size: 10, font, maxWidth: 500 });

writeFileSync("/tmp/fixture.pdf", await doc.save());
console.log("wrote /tmp/fixture.pdf");
TS

pnpm tsx /tmp/make-fixture.ts
```

Then:
```bash
curl -X POST -F "file=@/tmp/fixture.pdf" -F "niche=investing" http://localhost:3000/api/books
```
Expected: `{"bookId":"<cuid>","chapterCount":2}` (chapterCount may differ; just ensure no `error` field).

Stop the dev server (Ctrl-C).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/app/api/books apps/studio/package.json pnpm-lock.yaml
git commit -m "feat(api): POST /api/books — upload, parse, persist chapters

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: API routes — chapter editing

**Files:**
- Create: `apps/studio/app/api/chapters/[id]/route.ts`
- Create: `apps/studio/app/api/chapters/[id]/split/route.ts`

- [ ] **Step 1: Create main chapter route (PATCH + DELETE + merge)**

`apps/studio/app/api/chapters/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

async function renumber(bookId: string) {
  const chapters = await db.chapter.findMany({ where: { bookId }, orderBy: { orderIndex: "asc" } });
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i]!.orderIndex !== i) {
      await db.chapter.update({ where: { id: chapters[i]!.id }, data: { orderIndex: i } });
    }
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  // Merge with next?
  if (body.mergeWithNext === true) {
    const me = await db.chapter.findUniqueOrThrow({ where: { id } });
    const next = await db.chapter.findFirst({
      where: { bookId: me.bookId, orderIndex: { gt: me.orderIndex } },
      orderBy: { orderIndex: "asc" },
    });
    if (!next) return NextResponse.json({ error: "no next chapter to merge with" }, { status: 400 });
    await db.$transaction(async (tx) => {
      await tx.chapter.update({
        where: { id },
        data: {
          rawText: `${me.rawText}\n\n${next.rawText}`,
          endPage: next.endPage,
        },
      });
      await tx.idea.deleteMany({ where: { chapterId: next.id } });
      await tx.chapter.delete({ where: { id: next.id } });
    });
    await renumber(me.bookId);
    return NextResponse.json({ ok: true });
  }

  // Plain rename
  if (typeof body.title === "string") {
    const trimmed = body.title.trim();
    if (!trimmed) return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
    await db.chapter.update({ where: { id }, data: { title: trimmed } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "no recognized fields in body" }, { status: 400 });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await db.chapter.findUniqueOrThrow({ where: { id } });
  await db.$transaction(async (tx) => {
    await tx.idea.deleteMany({ where: { chapterId: id } });
    await tx.chapter.delete({ where: { id } });
  });
  await renumber(me.bookId);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Create split route**

`apps/studio/app/api/chapters/[id]/split/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { atOffset, newTitle } = (await req.json()) as { atOffset: number; newTitle: string };
  if (typeof atOffset !== "number" || atOffset < 1) {
    return NextResponse.json({ error: "atOffset must be a positive number" }, { status: 400 });
  }
  if (typeof newTitle !== "string" || !newTitle.trim()) {
    return NextResponse.json({ error: "newTitle required" }, { status: 400 });
  }

  const me = await db.chapter.findUniqueOrThrow({ where: { id } });
  if (atOffset >= me.rawText.length) {
    return NextResponse.json({ error: "atOffset past end of chapter" }, { status: 400 });
  }

  const left = me.rawText.slice(0, atOffset).trimEnd();
  const right = me.rawText.slice(atOffset).trimStart();

  await db.$transaction(async (tx) => {
    // Bump all chapters with orderIndex > me by +1
    await tx.chapter.updateMany({
      where: { bookId: me.bookId, orderIndex: { gt: me.orderIndex } },
      data: { orderIndex: { increment: 1 } },
    });
    await tx.chapter.update({
      where: { id },
      data: { rawText: left },
    });
    await tx.chapter.create({
      data: {
        bookId: me.bookId,
        title: newTitle.trim(),
        orderIndex: me.orderIndex + 1,
        startPage: me.startPage, // approximate; pages already overlap
        endPage: me.endPage,
        rawText: right,
        status: "pending",
      },
    });
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Type-check**

```bash
cd apps/studio && pnpm type-check
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/studio/app/api/chapters
git commit -m "feat(api): chapter PATCH/DELETE + split

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: API routes — extract trigger + job polling

**Files:**
- Create: `apps/studio/app/api/chapters/[id]/extract/route.ts`
- Create: `apps/studio/app/api/jobs/[id]/route.ts`
- Create: `apps/studio/lib/jobs/index.ts`

- [ ] **Step 1: Wire up handler registration**

`apps/studio/lib/jobs/index.ts`:

```ts
import { registerHandler } from "./runner";
import { handleExtractIdeas } from "./handlers/extract-ideas";

let registered = false;
export function ensureHandlersRegistered(): void {
  if (registered) return;
  registerHandler("extract_ideas", handleExtractIdeas);
  registered = true;
}

export { runJob, enqueueAndRun, recoverOrphans } from "./runner";
```

- [ ] **Step 2: Create extract trigger route**

`apps/studio/app/api/chapters/[id]/extract/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureHandlersRegistered, enqueueAndRun } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  ensureHandlersRegistered();
  const { id } = await params;
  await db.chapter.findUniqueOrThrow({ where: { id } });

  const job = await db.job.create({
    data: {
      type: "extract_ideas",
      status: "queued",
      targetType: "Chapter",
      targetId: id,
      payload: { chapterId: id },
    },
  });

  enqueueAndRun(job.id);

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
```

- [ ] **Step 3: Create job polling route**

`apps/studio/app/api/jobs/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await db.job.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
  return NextResponse.json({
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    error: job.error,
    result: job.result,
    targetType: job.targetType,
    targetId: job.targetId,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  });
}
```

- [ ] **Step 4: Type-check**

```bash
cd apps/studio && pnpm type-check
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/app/api/chapters/\[id\]/extract apps/studio/app/api/jobs apps/studio/lib/jobs/index.ts
git commit -m "feat(api): POST extract trigger + GET /api/jobs/[id] poll

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: UI — `/books/new` upload page

**Files:**
- Create: `apps/studio/app/books/new/page.tsx`
- Create: `apps/studio/app/books/new/UploadForm.tsx`

- [ ] **Step 1: Create the page (server)**

`apps/studio/app/books/new/page.tsx`:

```tsx
import { UploadForm } from "./UploadForm";

export default function NewBookPage() {
  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">New Book</h1>
        <p className="text-muted-foreground mt-1">Upload a PDF — we'll detect chapters automatically.</p>
      </header>
      <UploadForm />
    </main>
  );
}
```

- [ ] **Step 2: Create the client form**

`apps/studio/app/books/new/UploadForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const NICHES = [
  { value: "personal_finance", label: "Personal finance" },
  { value: "investing", label: "Investing" },
  { value: "entrepreneurship", label: "Entrepreneurship" },
  { value: "psychology", label: "Psychology" },
  { value: "other", label: "Other" },
];

export function UploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [niche, setNiche] = useState("investing");
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError("Pick a PDF first.");
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("niche", niche);
      if (title.trim()) fd.append("title", title.trim());
      const res = await fetch("/api/books", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "upload failed");
      router.push(`/books/${data.bookId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload PDF</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">PDF file</label>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-primary-foreground"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Niche</label>
            <select
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              {NICHES.map((n) => (
                <option key={n.value} value={n.value}>{n.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Title <span className="text-muted-foreground">(optional — defaults to filename)</span></label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="The Psychology of Money"
              className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          {error && <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
          <Button type="submit" disabled={submitting || !file}>
            {submitting ? "Uploading..." : "Upload & parse"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Verify the page in a browser**

In one terminal: `pnpm dev` (from repo root).
Visit `http://localhost:3000/books/new`. Pick the `/tmp/fixture.pdf` you made in Task 8. Submit.
Expected: form succeeds, redirects to `/books/<id>` (which 404s for now — that's Task 12).

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add apps/studio/app/books/new
git commit -m "feat(ui): /books/new upload form

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: UI — `/books/[id]` chapter editor

**Files:**
- Create: `apps/studio/app/books/[id]/page.tsx`
- Create: `apps/studio/app/books/[id]/ChapterEditor.tsx`
- Create: `apps/studio/app/books/[id]/SplitModal.tsx`

- [ ] **Step 1: Create the server page**

`apps/studio/app/books/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ChapterEditor } from "./ChapterEditor";

export const dynamic = "force-dynamic";

export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const book = await db.book.findUnique({
    where: { id },
    include: {
      chapters: {
        orderBy: { orderIndex: "asc" },
        include: { _count: { select: { ideas: true } } },
      },
    },
  });
  if (!book) notFound();

  const chapters = book.chapters.map((c) => ({
    id: c.id,
    title: c.title,
    orderIndex: c.orderIndex,
    startPage: c.startPage,
    endPage: c.endPage,
    wordCount: c.rawText.trim().split(/\s+/).filter(Boolean).length,
    status: c.status,
    ideaCount: c._count.ideas,
    rawText: c.rawText,
  }));

  return (
    <main className="max-w-4xl mx-auto p-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">{book.title}</h1>
        <p className="text-muted-foreground mt-1">
          {book.niche.replace("_", " ")} · {book.pageCount} pages · {chapters.length} chapters
        </p>
      </header>
      <ChapterEditor bookId={book.id} initialChapters={chapters} />
    </main>
  );
}
```

- [ ] **Step 2: Create the client editor**

`apps/studio/app/books/[id]/ChapterEditor.tsx`:

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SplitModal } from "./SplitModal";

type ChapterRow = {
  id: string;
  title: string;
  orderIndex: number;
  startPage: number;
  endPage: number;
  wordCount: number;
  status: string;
  ideaCount: number;
  rawText: string;
};

type JobInfo = { jobId: string; status: string; progress: number; error: string | null };

export function ChapterEditor({ bookId, initialChapters }: { bookId: string; initialChapters: ChapterRow[] }) {
  const router = useRouter();
  const [chapters, setChapters] = useState(initialChapters);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [splittingId, setSplittingId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<string, JobInfo>>({}); // chapterId -> latest job

  // Refresh state from server (after mutations).
  const refresh = useCallback(() => router.refresh(), [router]);

  // Poll active jobs. Pause when the tab is hidden; resume on visibility change.
  useEffect(() => {
    const activeEntries = Object.entries(jobs).filter(
      ([, j]) => j.status === "queued" || j.status === "running"
    );
    if (activeEntries.length === 0) return;

    let cancelled = false;
    const tick = async () => {
      if (cancelled || document.hidden) return;
      const updates: Record<string, JobInfo> = {};
      let anyTerminal = false;
      for (const [chapterId, j] of activeEntries) {
        try {
          const res = await fetch(`/api/jobs/${j.jobId}`, { cache: "no-store" });
          if (!res.ok) continue;
          const data = await res.json();
          updates[chapterId] = {
            jobId: data.id,
            status: data.status,
            progress: data.progress,
            error: data.error,
          };
          if (data.status === "completed" || data.status === "failed") {
            anyTerminal = true;
          }
        } catch {
          // transient errors are non-fatal; next tick will retry
        }
      }
      if (cancelled) return;
      if (Object.keys(updates).length > 0) {
        setJobs((prev) => ({ ...prev, ...updates }));
      }
      if (anyTerminal) refresh();
    };

    const interval = setInterval(tick, 2000);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [jobs, refresh]);

  async function startEdit(c: ChapterRow) {
    setEditingId(c.id);
    setEditValue(c.title);
  }

  async function saveTitle(c: ChapterRow) {
    if (editValue.trim() && editValue !== c.title) {
      await fetch(`/api/chapters/${c.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: editValue.trim() }),
      });
      setChapters((cs) => cs.map((x) => (x.id === c.id ? { ...x, title: editValue.trim() } : x)));
    }
    setEditingId(null);
  }

  async function deleteChapter(c: ChapterRow) {
    if (!confirm(`Delete chapter "${c.title}"? This also deletes its ideas.`)) return;
    await fetch(`/api/chapters/${c.id}`, { method: "DELETE" });
    setChapters((cs) => cs.filter((x) => x.id !== c.id).map((x, i) => ({ ...x, orderIndex: i })));
    refresh();
  }

  async function mergeWithNext(c: ChapterRow) {
    if (!confirm(`Merge "${c.title}" with the next chapter? Ideas on the next chapter will be deleted.`)) return;
    await fetch(`/api/chapters/${c.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mergeWithNext: true }),
    });
    refresh();
  }

  async function extract(c: ChapterRow) {
    const res = await fetch(`/api/chapters/${c.id}/extract`, { method: "POST" });
    const data = await res.json();
    setJobs((j) => ({ ...j, [c.id]: { jobId: data.jobId, status: "queued", progress: 0, error: null } }));
  }

  async function extractAll() {
    const pending = chapters.filter((c) => c.ideaCount === 0);
    for (const c of pending) {
      // sequential enqueue to avoid hammering the API; jobs themselves run concurrently in-process
      await extract(c);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Chapters</CardTitle>
          <Button size="sm" onClick={extractAll}>Extract all</Button>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {chapters.map((c, i) => {
              const job = jobs[c.id];
              return (
                <li key={c.id} className="flex items-start justify-between border-b border-border py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground text-sm w-6">{i + 1}.</span>
                      {editingId === c.id ? (
                        <input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => saveTitle(c)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveTitle(c);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
                        />
                      ) : (
                        <button onClick={() => startEdit(c)} className="font-medium text-left hover:underline">
                          {c.title}
                        </button>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 ml-9">
                      pp. {c.startPage + 1}–{c.endPage + 1} · {c.wordCount.toLocaleString()} words
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    {c.ideaCount > 0 ? (
                      <Link href={`/books/${bookId}/chapters/${c.id}`}>
                        <Badge variant="success">{c.ideaCount} ideas</Badge>
                      </Link>
                    ) : job ? (
                      job.status === "failed" ? (
                        <Badge variant="error" title={job.error ?? ""}>failed</Badge>
                      ) : (
                        <Badge variant="warn">{job.status} {job.progress}%</Badge>
                      )
                    ) : (
                      <Badge variant="outline">pending</Badge>
                    )}
                    <Button size="sm" variant="outline" onClick={() => extract(c)} disabled={job?.status === "running" || job?.status === "queued"}>
                      {c.ideaCount > 0 ? "Re-extract" : "Extract ideas"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSplittingId(c.id)}>Split</Button>
                    {i < chapters.length - 1 && (
                      <Button size="sm" variant="ghost" onClick={() => mergeWithNext(c)}>Merge↓</Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => deleteChapter(c)}>Delete</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {splittingId && (
        <SplitModal
          chapter={chapters.find((c) => c.id === splittingId)!}
          onClose={() => setSplittingId(null)}
          onSplit={() => {
            setSplittingId(null);
            refresh();
          }}
        />
      )}
    </>
  );
}
```

- [ ] **Step 3: Create the split modal**

`apps/studio/app/books/[id]/SplitModal.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type ChapterLike = { id: string; title: string; rawText: string };

export function SplitModal({ chapter, onClose, onSplit }: { chapter: ChapterLike; onClose: () => void; onSplit: () => void }) {
  const [atOffset, setAtOffset] = useState<number | null>(null);
  const [newTitle, setNewTitle] = useState("New chapter");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Break the chapter text into paragraphs; clicking between them sets atOffset.
  const paragraphs: { text: string; endOffset: number }[] = [];
  let runningOffset = 0;
  for (const para of chapter.rawText.split(/\n\s*\n/)) {
    runningOffset += para.length + 2;
    paragraphs.push({ text: para, endOffset: runningOffset });
  }

  async function submit() {
    if (atOffset === null) {
      setError("Click between two paragraphs to choose a split point.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/chapters/${chapter.id}/split`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ atOffset, newTitle: newTitle.trim() || "New chapter" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "split failed");
      }
      onSplit();
    } catch (e) {
      setError(e instanceof Error ? e.message : "split failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-lg max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold">Split "{chapter.title}"</h2>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>
        <div className="p-4 overflow-y-auto space-y-1 flex-1">
          {paragraphs.map((p, i) => (
            <div key={i}>
              <div className="text-sm whitespace-pre-wrap">{p.text}</div>
              {i < paragraphs.length - 1 && (
                <button
                  onClick={() => setAtOffset(p.endOffset)}
                  className={`block w-full my-2 py-1 text-xs rounded border ${
                    atOffset === p.endOffset
                      ? "border-primary bg-primary/20 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  {atOffset === p.endOffset ? "↑ split here ↓" : "split here"}
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-border space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">New chapter title</label>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          {error && <div className="text-sm text-red-300">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={submitting || atOffset === null}>
              {submitting ? "Splitting..." : "Split"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify the page in a browser**

In one terminal: `pnpm dev`.
Visit `/books/new`, upload `/tmp/fixture.pdf`. Land on `/books/<id>`. You should see chapters; try rename, delete, split, merge. Each action should persist (refresh page to confirm).

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/app/books/\[id\]
git commit -m "feat(ui): chapter editor with rename/split/merge/delete + job polling

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: UI — `/books/[id]/chapters/[cid]` idea cards

**Files:**
- Create: `apps/studio/app/books/[id]/chapters/[cid]/page.tsx`
- Create: `apps/studio/app/books/[id]/chapters/[cid]/IdeaCard.tsx`

- [ ] **Step 1: Create the server page**

`apps/studio/app/books/[id]/chapters/[cid]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { IdeaCard } from "./IdeaCard";

export const dynamic = "force-dynamic";

export default async function ChapterIdeasPage({ params }: { params: Promise<{ id: string; cid: string }> }) {
  const { id, cid } = await params;
  const chapter = await db.chapter.findUnique({
    where: { id: cid },
    include: { ideas: { orderBy: { id: "asc" } }, book: true },
  });
  if (!chapter || chapter.bookId !== id) notFound();

  return (
    <main className="max-w-5xl mx-auto p-8 space-y-6">
      <header className="space-y-2">
        <Link href={`/books/${id}`} className="text-sm text-muted-foreground hover:underline">← {chapter.book.title}</Link>
        <h1 className="text-3xl font-bold">{chapter.title}</h1>
        <p className="text-muted-foreground">
          pp. {chapter.startPage + 1}–{chapter.endPage + 1} · {chapter.ideas.length} ideas
        </p>
      </header>
      {chapter.ideas.length === 0 ? (
        <p className="text-muted-foreground">No ideas yet. Click "Extract ideas" on the chapter list.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {chapter.ideas.map((idea) => (
            <IdeaCard
              key={idea.id}
              title={idea.title}
              summary={idea.summary}
              targetLengthSec={idea.targetLengthSec}
              sourceQuotes={(idea.sourceQuotes as string[] | null) ?? []}
              candidateHooks={(idea.candidateHooks as string[] | null) ?? []}
            />
          ))}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Create the card component**

`apps/studio/app/books/[id]/chapters/[cid]/IdeaCard.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function IdeaCard({
  title,
  summary,
  targetLengthSec,
  sourceQuotes,
  candidateHooks,
}: {
  title: string;
  summary: string;
  targetLengthSec: number;
  sourceQuotes: string[];
  candidateHooks: string[];
}) {
  const [showQuotes, setShowQuotes] = useState(false);
  const [showHooks, setShowHooks] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <CardTitle className="text-base leading-snug">{title}</CardTitle>
        <Badge variant="outline">{targetLengthSec}s</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">{summary}</p>
        <div className="space-y-1">
          <button onClick={() => setShowHooks((s) => !s)} className="text-xs text-muted-foreground hover:text-foreground">
            {showHooks ? "▾" : "▸"} candidate hooks ({candidateHooks.length})
          </button>
          {showHooks && (
            <ul className="text-xs space-y-1 ml-3">
              {candidateHooks.map((h, i) => (
                <li key={i} className="text-muted-foreground">— {h}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-1">
          <button onClick={() => setShowQuotes((s) => !s)} className="text-xs text-muted-foreground hover:text-foreground">
            {showQuotes ? "▾" : "▸"} source quotes ({sourceQuotes.length})
          </button>
          {showQuotes && (
            <ul className="text-xs space-y-1 ml-3">
              {sourceQuotes.map((q, i) => (
                <li key={i} className="text-muted-foreground italic">"{q}"</li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/studio/app/books/\[id\]/chapters
git commit -m "feat(ui): idea cards page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Orphan recovery on app start

**Files:**
- Create: `apps/studio/instrumentation.ts`

- [ ] **Step 1: Create instrumentation hook**

`apps/studio/instrumentation.ts`:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { recoverOrphans } = await import("./lib/jobs");
    const n = await recoverOrphans();
    if (n > 0) {
      // eslint-disable-next-line no-console
      console.log(`[jobs] recovered ${n} orphaned running job(s) as failed`);
    }
  }
}
```

Note: Next.js 15 auto-detects `instrumentation.ts` at the app root with no config change required.

- [ ] **Step 2: Verify it runs**

`pnpm dev` and watch the server log for the `[jobs] recovered N orphan...` message. The first time it should print 0 (clean DB after Task 7's tests cleared the table). Stop dev.

- [ ] **Step 3: Commit**

```bash
git add apps/studio/instrumentation.ts
git commit -m "feat(jobs): recover orphan running jobs on app start

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Phase 1 smoke + final verification

**Files:**
- Create: `scripts/smoke/phase1-hello.ts`
- Modify: `package.json` (add `smoke:phase1` script)

- [ ] **Step 1: Add the smoke script**

`scripts/smoke/phase1-hello.ts`:

```ts
import { config } from "dotenv";
config({ path: ".env.local" });
import { parsePdf, detectChapters } from "../../packages/parsers/src";
import { makeFixturePdf } from "../../packages/parsers/src/fixtures";
import { extractIdeas } from "../../packages/pipeline/src";

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("FAIL: ANTHROPIC_API_KEY missing");
    process.exit(1);
  }

  const finance = `Chapter 1
The Power of Compound Interest

Compound interest is the eighth wonder of the world. He who understands it, earns it; he who doesn't, pays it. A small amount invested early outperforms a large amount invested late because of doubling time. Consider two savers: Anna who invests $300/month from age 25 to 35 then stops, and Bob who invests $300/month from age 35 to 65. By age 65, Anna ends up with more money than Bob despite contributing for only ten years. The reason is that her early dollars have more years to double. Time, not amount, is the primary lever. Most investors get this exactly backwards.

The doubling rule of 72 makes this concrete: at 7% returns, money doubles every 10.3 years. At 10%, every 7.2 years. The first double matters less than the last double, because the last double is a much bigger absolute amount. This is why compounding feels slow at first and then accelerates.

Chapter 2
Why Index Funds Win

Active managers underperform their benchmark over 10-year windows in roughly 85% of cases. The reasons are well-documented: fees compound, market timing fails, and concentration risk punishes most managers eventually. The S&P 500 has returned an average of about 10% nominally over the long run, and a low-fee index fund captures that with almost no effort. Investors who try to beat the market typically end up paying more in fees and taxes than they earn in alpha.

A simple three-fund portfolio — total US, total international, and total bond — beats most professionally-managed retirement accounts after fees. The hardest part isn't picking the funds; it's staying the course during a 30% drawdown.`.repeat(2);

  console.log("==> parsing synthetic PDF...");
  const buf = await makeFixturePdf([finance]);
  const parsed = await parsePdf(buf);
  console.log(`    ${parsed.pageCount} pages`);

  const chapters = detectChapters(parsed.pages);
  console.log(`==> detected ${chapters.length} chapters`);
  if (chapters.length === 0) {
    console.error("FAIL: 0 chapters detected");
    process.exit(1);
  }

  const target = chapters[0]!;
  console.log(`==> extracting ideas from "${target.title}" (${target.rawText.length} chars)...`);
  const t0 = Date.now();
  const result = await extractIdeas({ chapterText: target.rawText, apiKey });
  console.log(`    got ${result.ideas.length} ideas in ${Date.now() - t0}ms`);
  console.log(`    tokens: in=${result.usage.inputTokens} out=${result.usage.outputTokens} cache_create=${result.usage.cacheCreationTokens} cache_read=${result.usage.cacheReadTokens}`);
  for (const i of result.ideas) console.log(`    - [${i.targetLengthSec}s] ${i.title}`);

  if (result.ideas.length < 1) {
    console.error("FAIL: no ideas returned");
    process.exit(1);
  }
  console.log("OK: phase1-hello passed");
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
```

- [ ] **Step 2: Register the script**

Edit `package.json`. In the `scripts` block, add (after `smoke:remotion`):

```json
    "smoke:phase1": "pnpm tsx scripts/smoke/phase1-hello.ts",
```

- [ ] **Step 3: Run unit + integration tests**

```bash
pnpm test
```
Expected: all tests pass (Phase 0's 9 + Phase 1's new ones — runner: 3, extract-ideas: 2, parsers/pdf: 2, parsers/chapters: 6, pipeline/extract: 4 = 26 total).

- [ ] **Step 4: Run the Phase 1 smoke**

```bash
pnpm smoke:phase1
```
Expected: prints ≥1 idea, exits 0. Token usage includes a non-zero `cache_create` value on this first run.

- [ ] **Step 5: Manual UI verification**

`pnpm dev` (from repo root).

Walk the happy path:
1. Visit `http://localhost:3000/books/new`.
2. Upload `/tmp/fixture.pdf` (the one from Task 8). Pick niche, submit.
3. On `/books/[id]`, you see ≥2 chapters. Rename one. Confirm persistence on reload.
4. Click "Extract ideas" on a chapter. The badge cycles to running/N% and eventually to "N ideas".
5. Click the ideas badge → land on `/books/[id]/chapters/[cid]`. You see ≥1 card with a target length pill. Expand candidateHooks and sourceQuotes.

Stop dev with Ctrl-C.

- [ ] **Step 6: Final commit + tag**

```bash
git add scripts/smoke/phase1-hello.ts package.json
git commit -m "feat(smoke): phase1-hello end-to-end

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git commit --allow-empty -m "chore: Phase 1 complete — book → chapters → ideas

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git tag phase-1-complete
```

---

## Acceptance criteria for Phase 1

1. ✅ User uploads a real finance PDF and lands on `/books/[id]` with 3+ chapters detected
2. ✅ Rename, delete, split, merge persist across reload
3. ✅ "Extract ideas" cycles `queued → running → completed` in ~15s; ≥3 ideas appear on `/books/[id]/chapters/[cid]`
4. ✅ Each idea has `title`, `summary`, `targetLengthSec`, `sourceQuotes`, `candidateHooks`
5. ✅ `ApiUsage.cacheReadTokens > 0` on a second extraction of the same chapter within ~5 min
6. ✅ `pnpm test` green
7. ✅ `pnpm smoke:phase1` exits 0
8. ✅ `phase-1-complete` tag exists

If any of these fail, debug before moving to Phase 2.
