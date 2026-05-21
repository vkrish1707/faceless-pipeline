import { NextResponse } from "next/server";
import path from "node:path";
import { existsSync } from "node:fs";
import { db } from "@/lib/db";
import { ensureHandlersRegistered, enqueueAndRun } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/**
 * Re-render from the saved `output/<scriptId>/render-input.json`. Useful for:
 *  - swapping a single picked asset (UI updates pickedAssetId, then re-render),
 *  - theme experiments (dark vs light),
 *  - debugging a Remotion regression without rebuilding all the inputs.
 *
 * 404 if no prior render-input.json exists. The render handler reads the JSON
 * itself when payload.reuseInput=true.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  ensureHandlersRegistered();
  const { id } = await params;

  const render = await db.render.findUnique({ where: { id } });
  if (!render) {
    return NextResponse.json({ error: "render not found" }, { status: 404 });
  }

  const outputRoot = path.resolve("output");
  const renderInputPath = path.join(outputRoot, render.scriptId, "render-input.json");
  if (!existsSync(renderInputPath)) {
    return NextResponse.json(
      { error: "no saved render-input.json — run a full render first" },
      { status: 404 }
    );
  }

  await db.render.update({
    where: { id },
    data: {
      status: "queued",
      progress: 0,
      error: null,
      warning: null,
      startedAt: new Date(),
      completedAt: null,
    },
  });

  const job = await db.job.create({
    data: {
      type: "render_script",
      status: "queued",
      targetType: "Render",
      targetId: id,
      payload: { scriptId: render.scriptId, reuseInput: true },
    },
  });

  enqueueAndRun(job.id);

  return NextResponse.json({ renderId: id, jobId: job.id }, { status: 202 });
}
