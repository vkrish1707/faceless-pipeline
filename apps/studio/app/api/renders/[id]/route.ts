import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const render = await db.render.findUnique({
    where: { id },
    include: { script: { include: { idea: true } } },
  });
  if (!render) return NextResponse.json({ error: "render not found" }, { status: 404 });

  return NextResponse.json({
    id: render.id,
    scriptId: render.scriptId,
    scriptTitle: render.script.idea.title,
    status: render.status,
    progress: render.progress,
    durationSec: render.durationSec,
    fileSizeMB: render.fileSizeMB,
    error: render.error,
    warning: render.warning,
    audioUrl: render.audioPath ? `/api/renders/${render.id}/audio` : null,
    captionsUrl: render.captionsPath ? `/api/renders/${render.id}/captions` : null,
    startedAt: render.startedAt,
    completedAt: render.completedAt,
  });
}
