import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { summarizeUsage } from "@/lib/cost/today";

export const dynamic = "force-dynamic";

/**
 * Cost badge backend. Cached for 30s in-process so a steady stream of
 * 30s-interval polls from the header badge doesn't hammer ApiUsage.
 *
 * The `book` query param scopes the second figure: we look up every Job
 * whose traceId chain leads back to the book (synthesize_script /
 * render_script / fetch_broll / etc.) and sum the ApiUsage rows tagged
 * with those job ids.
 */
const CACHE_TTL_MS = 30_000;
type CacheEntry = { at: number; body: { todayUsd: number; bookUsd: number; traceCount: number } };
const cache = new Map<string, CacheEntry>();

export async function GET(req: Request) {
  const url = new URL(req.url);
  const bookId = url.searchParams.get("book");
  const key = bookId ?? "_all";
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...cached.body, cached: true });
  }

  // Pull only the last 7 days — enough for the badge and keeps queries quick.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await db.apiUsage.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
  });

  let bookTraceIds: Set<string> | undefined;
  if (bookId) {
    // Match jobs whose targetType + targetId join back to a chapter/script/
    // render under this book.
    const chapters = await db.chapter.findMany({
      where: { bookId },
      select: { id: true, ideas: { select: { id: true, script: { select: { id: true, render: { select: { id: true } } } } } } },
    });
    const chapterIds = new Set<string>();
    const ideaIds = new Set<string>();
    const scriptIds = new Set<string>();
    const renderIds = new Set<string>();
    for (const c of chapters) {
      chapterIds.add(c.id);
      for (const i of c.ideas) {
        ideaIds.add(i.id);
        if (i.script) {
          scriptIds.add(i.script.id);
          if (i.script.render) renderIds.add(i.script.render.id);
        }
      }
    }
    const jobs = await db.job.findMany({
      where: {
        OR: [
          { targetType: "Chapter", targetId: { in: Array.from(chapterIds) } },
          { targetType: "Idea", targetId: { in: Array.from(ideaIds) } },
          { targetType: "Script", targetId: { in: Array.from(scriptIds) } },
          { targetType: "Render", targetId: { in: Array.from(renderIds) } },
        ],
      },
      select: { id: true },
    });
    bookTraceIds = new Set(jobs.map((j) => j.id));
  }

  const summary = summarizeUsage({ rows, bookTraceIds });
  cache.set(key, { at: Date.now(), body: summary });
  return NextResponse.json(summary);
}
