import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureHandlersRegistered, enqueueAndRun } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  ensureHandlersRegistered();
  const { id } = await params;
  const chapter = await db.chapter.findUnique({
    where: { id },
    include: { _count: { select: { ideas: true } } },
  });
  if (!chapter) return NextResponse.json({ error: "chapter not found" }, { status: 404 });
  if (chapter._count.ideas === 0) {
    return NextResponse.json({ error: "chapter has no ideas to score" }, { status: 400 });
  }

  await db.suggestion.deleteMany({ where: { chapterId: id, status: "open" } });

  const job = await db.job.create({
    data: {
      type: "score_chapter",
      status: "queued",
      targetType: "Chapter",
      targetId: id,
      payload: { chapterId: id },
    },
  });

  enqueueAndRun(job.id);

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
