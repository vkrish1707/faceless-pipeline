import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureHandlersRegistered, enqueueAndRun } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  ensureHandlersRegistered();
  const { id } = await params;
  const script = await db.script.findUnique({ where: { id }, select: { id: true } });
  if (!script) return NextResponse.json({ error: "script not found" }, { status: 404 });

  const job = await db.job.create({
    data: {
      type: "rescore_script",
      status: "queued",
      targetType: "Script",
      targetId: id,
      payload: { scriptId: id },
    },
  });
  enqueueAndRun(job.id);

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
