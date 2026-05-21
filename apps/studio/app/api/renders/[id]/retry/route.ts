import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureHandlersRegistered, enqueueAndRun } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/**
 * One-click retry for a failed render. Verifies Phase 4 (audio + captions)
 * and Phase 5 (all beat picks) prerequisites are still present — if a user
 * has deleted them mid-flight we 409 with a clear explanation instead of
 * silently re-running and dying inside the render pipeline.
 *
 * Resets the Render row's videoPath/metadataPath/error fields to null,
 * marks the row queued, and enqueues a fresh `render_script` job. The
 * existing audio + captions + asset picks are reused — Phases 4 and 5 are
 * not re-run.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  ensureHandlersRegistered();
  const { id } = await params;

  const render = await db.render.findUnique({
    where: { id },
    include: { script: true },
  });
  if (!render) {
    return NextResponse.json({ error: "render not found" }, { status: 404 });
  }
  if (render.status !== "failed") {
    return NextResponse.json(
      { error: `cannot retry render with status=${render.status}` },
      { status: 409 }
    );
  }

  const missing: string[] = [];
  if (!render.audioPath) missing.push("audio");
  if (!render.captionsPath) missing.push("captions");
  type Beat = { pickedAssetId?: string | null };
  const beats = (render.script.visualBeats as unknown as Beat[]) ?? [];
  const missingPicks = beats.filter((b) => !b.pickedAssetId);
  if (missingPicks.length > 0) {
    missing.push(`picks (${missingPicks.length} of ${beats.length} beats)`);
  }
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: "missing prerequisites — re-run phase 4 (synthesize) or phase 5 (b-roll)",
        missing,
      },
      { status: 409 }
    );
  }

  await db.render.update({
    where: { id: render.id },
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
      payload: { scriptId: render.scriptId },
    },
  });
  enqueueAndRun(job.id);

  return NextResponse.json(
    { jobId: job.id, renderId: render.id },
    { status: 202 }
  );
}
