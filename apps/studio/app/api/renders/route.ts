import { NextResponse } from "next/server";
import path from "node:path";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Dashboard backfill. Returns every Render row, optionally filtered by
 * `?chapter=<id>`. Shape matches the per-row payload the WebSocket layer
 * pushes so the client can render the same component for both transports.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const chapterId = url.searchParams.get("chapter");

  const renders = await db.render.findMany({
    where: chapterId
      ? { script: { idea: { chapterId } } }
      : undefined,
    include: {
      script: {
        include: {
          idea: {
            include: { chapter: { select: { id: true, title: true } } },
          },
        },
      },
    },
    orderBy: [{ startedAt: "desc" }],
  });

  return NextResponse.json({
    rows: renders.map((r) => ({
      id: r.id,
      scriptId: r.scriptId,
      scriptTitle: r.script.idea.title,
      chapterId: r.script.idea.chapter.id,
      chapterTitle: r.script.idea.chapter.title,
      status: r.status,
      progress: r.progress,
      durationSec: r.durationSec,
      fileSizeMB: r.fileSizeMB,
      error: r.error,
      warning: r.warning,
      videoPath: r.videoPath,
      videoUrl: r.videoPath ? `/api/renders/${r.id}/video` : null,
      bundleDir: r.videoPath ? path.dirname(r.videoPath) : null,
      musicPath: r.musicPath,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
    })),
  });
}
