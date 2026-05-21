import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureHandlersRegistered, enqueueAndRun } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/**
 * Kick off a render_script job for a Script. The gate enforces the same
 * preconditions the UI's Render button checks — if any are missing we return
 * 409 with an explanation so the UI can surface a tooltip even when the gate
 * is bypassed.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  ensureHandlersRegistered();
  const { id } = await params;

  const script = await db.script.findUnique({
    where: { id },
    include: { render: true },
  });
  if (!script) return NextResponse.json({ error: "script not found" }, { status: 404 });

  const missing: string[] = [];
  if (!script.render?.audioPath) missing.push("audio");
  if (!script.render?.captionsPath) missing.push("captions");

  type Beat = { pickedAssetId?: string | null };
  const beats = (script.visualBeats as unknown as Beat[]) ?? [];
  const missingPicks = beats
    .map((b, i) => ({ idx: i, missing: !b.pickedAssetId }))
    .filter((x) => x.missing);
  if (missingPicks.length > 0) {
    missing.push(`picks (${missingPicks.length} of ${beats.length} beats)`);
  }

  if (missing.length > 0) {
    return NextResponse.json(
      { error: "render prerequisites missing", missing },
      { status: 409 }
    );
  }

  // Reset the existing Render row to a clean queued state — re-renders should
  // not surface a stale error from a prior failed attempt.
  const render = await db.render.update({
    where: { scriptId: id },
    data: {
      status: "queued",
      progress: 0,
      error: null,
      warning: null,
      videoPath: null,
      metadataPath: null,
      startedAt: new Date(),
      completedAt: null,
    },
  });

  const job = await db.job.create({
    data: {
      type: "render_script",
      status: "queued",
      targetType: "Render",
      targetId: render.id,
      payload: { scriptId: id },
    },
  });

  enqueueAndRun(job.id);

  return NextResponse.json({ renderId: render.id, jobId: job.id }, { status: 202 });
}
