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
