import { db } from "./db";

type StoredSuggestion = {
  id: string;
  chapterId: string;
  kind: string;
  payload: unknown;
  reason: string;
  status: string;
};

type MergePayload = { ideaIds: string[]; combinedTitle: string };
type SplitPayload = { ideaId: string; parts: Array<{ title: string; summary: string }> };
type DropPayload = { ideaId: string };
type SeriesPayload = { ideaIds: string[]; seriesTitle: string };
type ReframePayload = { ideaId: string; altHooks: string[] };

export async function applySuggestion(s: StoredSuggestion): Promise<void> {
  switch (s.kind) {
    case "drop":
      await applyDrop(s);
      break;
    case "merge":
      await applyMerge(s);
      break;
    case "split":
      await applySplit(s);
      break;
    case "series":
      await applySeries(s);
      break;
    case "reframe":
      await applyReframe(s);
      break;
    default:
      throw new Error(`conflict: unknown suggestion kind ${s.kind}`);
  }
}

async function applyDrop(s: StoredSuggestion) {
  const p = s.payload as DropPayload;
  await db.$transaction(async (tx) => {
    const idea = await tx.idea.findUnique({ where: { id: p.ideaId } });
    if (!idea) throw new Error(`conflict: idea ${p.ideaId} not found`);
    if (idea.status === "dropped") throw new Error(`conflict: idea already dropped`);
    await tx.idea.update({ where: { id: p.ideaId }, data: { status: "dropped" } });
    await tx.suggestion.update({
      where: { id: s.id },
      data: { status: "accepted", resolvedAt: new Date() },
    });
  });
}

async function applyMerge(s: StoredSuggestion) {
  const p = s.payload as MergePayload;
  await db.$transaction(async (tx) => {
    const ideas = await tx.idea.findMany({ where: { id: { in: p.ideaIds } } });
    if (ideas.length !== p.ideaIds.length) {
      throw new Error(`conflict: not all merge source ideas exist`);
    }
    if (ideas.some((i) => i.status === "dropped")) {
      throw new Error(`conflict: a merge source idea was already dropped`);
    }
    await tx.idea.updateMany({ where: { id: { in: p.ideaIds } }, data: { status: "dropped" } });
    await tx.idea.create({
      data: {
        chapterId: s.chapterId,
        title: p.combinedTitle,
        summary: ideas.map((i) => i.summary).join(" "),
        targetLengthSec: Math.max(...ideas.map((i) => i.targetLengthSec)),
        flags: { merged_from: p.ideaIds },
        status: "raw",
      },
    });
    await tx.suggestion.update({
      where: { id: s.id },
      data: { status: "accepted", resolvedAt: new Date() },
    });
  });
}

async function applySplit(s: StoredSuggestion) {
  const p = s.payload as SplitPayload;
  await db.$transaction(async (tx) => {
    const idea = await tx.idea.findUnique({ where: { id: p.ideaId } });
    if (!idea) throw new Error(`conflict: idea ${p.ideaId} not found`);
    if (idea.status === "dropped") throw new Error(`conflict: split source idea already dropped`);
    await tx.idea.update({ where: { id: p.ideaId }, data: { status: "dropped" } });
    for (const part of p.parts) {
      await tx.idea.create({
        data: {
          chapterId: s.chapterId,
          title: part.title,
          summary: part.summary,
          targetLengthSec: idea.targetLengthSec,
          flags: { split_from: p.ideaId },
          status: "raw",
        },
      });
    }
    await tx.suggestion.update({
      where: { id: s.id },
      data: { status: "accepted", resolvedAt: new Date() },
    });
  });
}

async function applySeries(s: StoredSuggestion) {
  const p = s.payload as SeriesPayload;
  const cuid = `series_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await db.$transaction(async (tx) => {
    const ideas = await tx.idea.findMany({ where: { id: { in: p.ideaIds } } });
    if (ideas.length !== p.ideaIds.length) {
      throw new Error(`conflict: not all series ideas exist`);
    }
    await tx.idea.updateMany({ where: { id: { in: p.ideaIds } }, data: { seriesId: cuid } });
    const first = ideas[0];
    if (first) {
      const existingFlags = (first.flags as Record<string, unknown> | null) ?? {};
      await tx.idea.update({
        where: { id: first.id },
        data: { flags: { ...existingFlags, seriesTitle: p.seriesTitle } },
      });
    }
    await tx.suggestion.update({
      where: { id: s.id },
      data: { status: "accepted", resolvedAt: new Date() },
    });
  });
}

async function applyReframe(s: StoredSuggestion) {
  const p = s.payload as ReframePayload;
  await db.$transaction(async (tx) => {
    const idea = await tx.idea.findUnique({ where: { id: p.ideaId } });
    if (!idea) throw new Error(`conflict: idea ${p.ideaId} not found`);
    const existingFlags = (idea.flags as Record<string, unknown> | null) ?? {};
    await tx.idea.update({
      where: { id: p.ideaId },
      data: { flags: { ...existingFlags, altHooks: p.altHooks } },
    });
    await tx.suggestion.update({
      where: { id: s.id },
      data: { status: "accepted", resolvedAt: new Date() },
    });
  });
}
