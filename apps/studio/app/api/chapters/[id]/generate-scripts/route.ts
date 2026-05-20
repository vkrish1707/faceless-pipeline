import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureHandlersRegistered, enqueueAndRun } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  ensureHandlersRegistered();
  const { id } = await params;
  const chapter = await db.chapter.findUnique({ where: { id } });
  if (!chapter) return NextResponse.json({ error: "chapter not found" }, { status: 404 });

  const approved = await db.idea.findMany({
    where: { chapterId: id, status: "approved" },
    select: { id: true },
  });
  if (approved.length === 0) {
    return NextResponse.json({ error: "no approved ideas" }, { status: 400 });
  }

  const ideaIds = approved.map((i) => i.id);
  const inFlight = await db.job.findMany({
    where: {
      type: "generate_script",
      status: { in: ["queued", "running"] },
      targetType: "Idea",
      targetId: { in: ideaIds },
    },
    select: { targetId: true },
  });
  const blocked = new Set(inFlight.map((j) => j.targetId));
  const ready = ideaIds.filter((i) => !blocked.has(i));
  if (ready.length === 0) {
    return NextResponse.json({ error: "all approved ideas already have a generation in flight" }, { status: 409 });
  }

  const groupId = randomUUID();
  const jobIds: string[] = [];
  for (const ideaId of ready) {
    const job = await db.job.create({
      data: {
        type: "generate_script",
        status: "queued",
        targetType: "Idea",
        targetId: ideaId,
        payload: { ideaId, groupId },
      },
    });
    jobIds.push(job.id);
    enqueueAndRun(job.id);
  }

  return NextResponse.json({ groupId, jobIds }, { status: 202 });
}
