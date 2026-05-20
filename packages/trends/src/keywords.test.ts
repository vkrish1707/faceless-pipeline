import { describe, it, expect } from "vitest";
import { extractKeywords } from "./keywords";

describe("extractKeywords", () => {
  it("prioritizes idea-title phrases over chapter phrases", () => {
    const chapter = "Saving money is the simple habit that builds wealth over decades.";
    const ideas = [{ title: "Compound interest rules early investing" }];
    const kws = extractKeywords(chapter, ideas);
    expect(kws[0]).toBe("compound interest rules early investing");
    expect(kws).toContain("compound interest rules early investing");
  });

  it("dedupes case-insensitively and caps at the requested cap", () => {
    const chapter = "Index Funds beat stock picking. INDEX FUNDS win. index funds win again.";
    const ideas = [
      { title: "Index funds win" },
      { title: "Index funds win" },
      { title: "Different idea about budgeting" },
    ];
    const kws = extractKeywords(chapter, ideas, { cap: 5 });
    const lower = kws.map((k) => k.toLowerCase());
    const set = new Set(lower);
    expect(set.size).toBe(lower.length);
    expect(kws.length).toBeLessThanOrEqual(5);
  });

  it("strips stopwords from phrase tails and heads", () => {
    const kws = extractKeywords("a savings account is for the cautious investor", [
      { title: "the dividend portfolio" },
    ]);
    expect(kws).not.toContain("the dividend portfolio");
    expect(kws).toContain("dividend portfolio");
  });

  it("returns deterministic order across runs", () => {
    const text = "Apples bananas cherries. Apples are red, bananas are yellow.";
    const ideas = [{ title: "Cherries pie recipe" }, { title: "Apples season facts" }];
    const a = extractKeywords(text, ideas);
    const b = extractKeywords(text, ideas);
    expect(a).toEqual(b);
  });
});
