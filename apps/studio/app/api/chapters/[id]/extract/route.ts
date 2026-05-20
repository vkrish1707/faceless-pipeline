import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureHandlersRegistered, enqueueAndRun } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  ensureHandlersRegistered();
  const { id } = await params;
  const chapter = await db.chapter.findUnique({ where: { id } });
  if (!chapter) return NextResponse.json({ error: "chapter not found" }, { status: 404 });

  const job = await db.job.create({
    data: {
      type: "extract_ideas",
      status: "queued",
      targetType: "Chapter",
      targetId: id,
      payload: { chapterId: id },
    },
  });

  enqueueAndRun(job.id);

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
