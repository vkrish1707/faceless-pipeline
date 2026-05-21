import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureHandlersRegistered, enqueueAndRun } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  ensureHandlersRegistered();
  const { id } = await params;
  const script = await db.script.findUnique({ where: { id } });
  if (!script) return NextResponse.json({ error: "script not found" }, { status: 404 });

  // Only one in-flight per script.
  const inFlight = await db.job.findFirst({
    where: {
      type: "fetch_broll",
      targetType: "Script",
      targetId: id,
      status: { in: ["queued", "running"] },
    },
  });
  if (inFlight) {
    return NextResponse.json({ error: "fetch_broll already in-flight", jobId: inFlight.id }, { status: 409 });
  }

  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "1";

  const job = await db.job.create({
    data: {
      type: "fetch_broll",
      status: "queued",
      targetType: "Script",
      targetId: id,
      payload: { scriptId: id, refresh },
    },
  });

  enqueueAndRun(job.id);

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
