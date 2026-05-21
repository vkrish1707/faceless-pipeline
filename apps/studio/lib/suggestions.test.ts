import { describe, it, expect, beforeEach } from "vitest";
import { db } from "./db";
import { applySuggestion } from "./suggestions";

describe("applySuggestion", () => {
  let chapterId: string;
  let ideaA: string;
  let ideaB: string;

  beforeEach(async () => {
    await db.pexelsCache.deleteMany();
    await db.asset.deleteMany();
    await db.render.deleteMany();
    await db.script.deleteMany();
    await db.suggestion.deleteMany();
    await db.render.deleteMany();
    await db.script.deleteMany();
    await db.idea.deleteMany();
    await db.chapter.deleteMany();
    await db.book.deleteMany();
    const book = await db.book.create({
      data: { title: "Test", filePath: "/tmp/x.pdf", niche: "investing", pageCount: 1, status: "ready" },
    });
    const chapter = await db.chapter.create({
      data: {
        bookId: book.id,
        title: "Chapter 1",
        orderIndex: 0,
        startPage: 0,
        endPage: 0,
        rawText: "x",
        status: "extracted",
      },
    });
    chapterId = chapter.id;
    const a = await db.idea.create({
      data: { chapterId, title: "A", summary: "a-summary", targetLengthSec: 30, status: "draft" },
    });
    const b = await db.idea.create({
      data: { chapterId, title: "B", summary: "b-summary", targetLengthSec: 60, status: "draft" },
    });
    ideaA = a.id;
    ideaB = b.id;
  });

  it("drop: marks idea status=dropped, suggestion status=accepted", async () => {
    const sug = await db.suggestion.create({
      data: { chapterId, kind: "drop", payload: { ideaId: ideaA }, reason: "weak hook", status: "open" },
    });
    await applySuggestion(sug);
    const idea = await db.idea.findUniqueOrThrow({ where: { id: ideaA } });
    expect(idea.status).toBe("dropped");
    const after = await db.suggestion.findUniqueOrThrow({ where: { id: sug.id } });
    expect(after.status).toBe("accepted");
    expect(after.resolvedAt).not.toBeNull();
  });

  it("merge: drops sources, creates a new idea with merged_from flags", async () => {
    const sug = await db.suggestion.create({
      data: {
        chapterId,
        kind: "merge",
        payload: { ideaIds: [ideaA, ideaB], combinedTitle: "AB merged" },
        reason: "same underlying claim",
        status: "open",
      },
    });
    await applySuggestion(sug);
    const a = await db.idea.findUniqueOrThrow({ where: { id: ideaA } });
    const b = await db.idea.findUniqueOrThrow({ where: { id: ideaB } });
    expect(a.status).toBe("dropped");
    expect(b.status).toBe("dropped");
    const all = await db.idea.findMany({ where: { chapterId } });
    const merged = all.find((i) => i.title === "AB merged");
    expect(merged).toBeDefined();
    expect((merged!.flags as { merged_from?: string[] }).merged_from).toEqual([ideaA, ideaB]);
    expect(merged!.targetLengthSec).toBe(60);
  });

  it("split: drops source, creates N parts", async () => {
    const sug = await db.suggestion.create({
      data: {
        chapterId,
        kind: "split",
        payload: {
          ideaId: ideaA,
          parts: [
            { title: "A part one", summary: "first half" },
            { title: "A part two", summary: "second half" },
          ],
        },
        reason: "two distinct hooks inside",
        status: "open",
      },
    });
    await applySuggestion(sug);
    const a = await db.idea.findUniqueOrThrow({ where: { id: ideaA } });
    expect(a.status).toBe("dropped");
    const all = await db.idea.findMany({ where: { chapterId } });
    expect(all.filter((i) => i.title.startsWith("A part"))).toHaveLength(2);
  });

  it("series: assigns shared seriesId and stores seriesTitle on first idea", async () => {
    const sug = await db.suggestion.create({
      data: {
        chapterId,
        kind: "series",
        payload: { ideaIds: [ideaA, ideaB], seriesTitle: "Investing 101" },
        reason: "natural part1/part2",
        status: "open",
      },
    });
    await applySuggestion(sug);
    const a = await db.idea.findUniqueOrThrow({ where: { id: ideaA } });
    const b = await db.idea.findUniqueOrThrow({ where: { id: ideaB } });
    expect(a.seriesId).not.toBeNull();
    expect(a.seriesId).toBe(b.seriesId);
    expect((a.flags as { seriesTitle?: string }).seriesTitle).toBe("Investing 101");
  });

  it("reframe: stores altHooks on the idea without changing status", async () => {
    const sug = await db.suggestion.create({
      data: {
        chapterId,
        kind: "reframe",
        payload: { ideaId: ideaA, altHooks: ["hook 1 stronger version", "hook 2 alt"] },
        reason: "title weak vs idea",
        status: "open",
      },
    });
    await applySuggestion(sug);
    const a = await db.idea.findUniqueOrThrow({ where: { id: ideaA } });
    expect(a.status).toBe("draft");
    expect((a.flags as { altHooks?: string[] }).altHooks).toEqual(["hook 1 stronger version", "hook 2 alt"]);
  });

  it("drop: rejects when idea is already dropped", async () => {
    await db.idea.update({ where: { id: ideaA }, data: { status: "dropped" } });
    const sug = await db.suggestion.create({
      data: { chapterId, kind: "drop", payload: { ideaId: ideaA }, reason: "weak", status: "open" },
    });
    await expect(applySuggestion(sug)).rejects.toThrow(/conflict/);
  });
});
