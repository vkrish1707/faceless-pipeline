import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureHandlersRegistered, enqueueAndRun } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/**
 * Enqueue a `render_script` job for every approved script in `chapterId`
 * whose Phase 4 (audio + captions) and Phase 5 (all beat picks) gates are
 * already green. Scripts without a Render row yet get one created. Scripts
 * missing prerequisites are silently skipped — the UI surfaces them as a
 * "not ready" count instead of failing the bulk action.
 *
 * Concurrency is enforced inside `enqueueAndRun` via a shared `p-limit`
 * (default 2, configurable through Setting("render_concurrency")). The
 * route enqueues all jobs immediately and returns 202 with the list of
 * created job + script ids.
 */
export async function POST(req: Request) {
  ensureHandlersRegistered();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }
  const chapterId =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).chapterId
      : undefined;
  if (typeof chapterId !== "string" || chapterId.length === 0) {
    return NextResponse.json(
      { error: "chapterId is required" },
      { status: 400 }
    );
  }

  const chapter = await db.chapter.findUnique({ where: { id: chapterId } });
  if (!chapter) {
    return NextResponse.json({ error: "chapter not found" }, { status: 404 });
  }

  // Every script under this chapter — eagerly include each script's Render
  // row so we can compute the gate without an extra query per script.
  const scripts = await db.script.findMany({
    where: { idea: { chapterId } },
    include: { render: true },
  });

  type Beat = { pickedAssetId?: string | null };
  const ready = scripts.filter((s) => {
    if (s.status !== "approved") return false;
    if (!s.render?.audioPath || !s.render?.captionsPath) return false;
    const beats = (s.visualBeats as unknown as Beat[]) ?? [];
    if (beats.length === 0) return false;
    return beats.every((b) => Boolean(b.pickedAssetId));
  });

  const skipped = scripts
    .filter((s) => !ready.find((r) => r.id === s.id))
    .map((s) => s.id);

  if (ready.length === 0) {
    return NextResponse.json(
      { jobIds: [], scriptIds: [], skipped, error: "no ready scripts" },
      { status: 409 }
    );
  }

  const jobIds: string[] = [];
  const scriptIds: string[] = [];
  for (const script of ready) {
    // Reset the Render row to queued state so the dashboard reflects "pending"
    // immediately. The render handler is idempotent against this.
    const render = await db.render.update({
      where: { scriptId: script.id },
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
        payload: { scriptId: script.id },
      },
    });
    jobIds.push(job.id);
    scriptIds.push(script.id);
    enqueueAndRun(job.id);
  }

  return NextResponse.json(
    { jobIds, scriptIds, skipped },
    { status: 202 }
  );
}
