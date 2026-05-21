import { NextResponse } from "next/server";
import path from "node:path";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Single-render state for the dashboard's reconnect backfill path. Same
 * row shape as the bulk `/api/renders` route.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await db.render.findUnique({
    where: { id },
    include: {
      script: {
        include: {
          idea: {
            include: { chapter: { select: { id: true, title: true } } },
          },
        },
      },
    },
  });
  if (!r) return NextResponse.json({ error: "render not found" }, { status: 404 });

  return NextResponse.json({
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
  });
}
