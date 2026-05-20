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
      const trimmed = lines[l]!.trim();
      const m = trimmed.match(HEADING_REGEX);
      if (m) {
        // If there's inline text after the chapter/part marker, use it as the title.
        const prefix = m[0]!;
        const inlineRemainder = trimmed.slice(prefix.length).trim();
        let title: string;
        if (inlineRemainder) {
          title = inlineRemainder;
        } else {
          // Look at the *next non-empty* line as title.
          title = trimmed; // fallback to the heading line itself
          for (let k = l + 1; k < Math.min(lines.length, l + 3); k++) {
            const t = lines[k]!.trim();
            if (t && !/^\s*$/.test(t)) {
              title = t;
              break;
            }
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
