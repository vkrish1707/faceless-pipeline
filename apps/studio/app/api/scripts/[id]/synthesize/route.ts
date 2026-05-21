import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureHandlersRegistered, enqueueAndRun } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  ensureHandlersRegistered();
  const { id } = await params;

  const script = await db.script.findUnique({ where: { id } });
  if (!script) return NextResponse.json({ error: "script not found" }, { status: 404 });

  // Upsert the Render row up-front so the UI has something to poll against
  // (and so re-syntheses don't accumulate phantom rows). We reset
  // status/progress/error so the user sees a clean "queued" state.
  const render = await db.render.upsert({
    where: { scriptId: id },
    update: {
      status: "queued",
      progress: 0,
      error: null,
      warning: null,
      startedAt: new Date(),
      completedAt: null,
    },
    create: {
      scriptId: id,
      status: "queued",
      progress: 0,
      startedAt: new Date(),
    },
  });

  const job = await db.job.create({
    data: {
      type: "synthesize_script",
      status: "queued",
      targetType: "Render",
      targetId: render.id,
      payload: { scriptId: id },
    },
  });

  enqueueAndRun(job.id);

  return NextResponse.json({ renderId: render.id, jobId: job.id }, { status: 202 });
}
