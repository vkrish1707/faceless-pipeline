import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ensureHandlersRegistered, enqueueAndRun } from "@/lib/jobs";
import { dedupeHashtags, buildWarnings } from "@/lib/scripts/validators";
import { shouldRescore } from "@/lib/scripts/diff";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  hook: z.string().min(5).max(180).optional(),
  body: z.string().min(50).max(800).optional(),
  cta: z.string().min(5).max(120).optional(),
  metadata: z
    .object({
      youtubeTitle: z.string().min(5).max(60).optional(),
      caption: z.string().min(10).max(280).optional(),
      hashtags: z.array(z.string().regex(/^#[a-zA-Z0-9_]+$/)).max(8).optional(),
      thumbnailConcept: z.string().min(10).max(200).optional(),
    })
    .partial()
    .optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const script = await db.script.findUnique({
    where: { id },
    include: { idea: { select: { id: true, title: true, targetLengthSec: true, score: true } } },
  });
  if (!script) return NextResponse.json({ error: "script not found" }, { status: 404 });
  return NextResponse.json(script);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  ensureHandlersRegistered();
  const { id } = await params;
  const existing = await db.script.findUnique({
    where: { id },
    include: { idea: { select: { targetLengthSec: true } } },
  });
  if (!existing) return NextResponse.json({ error: "script not found" }, { status: 404 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parse = PatchSchema.safeParse(raw);
  if (!parse.success) {
    return NextResponse.json({ error: parse.error.message }, { status: 400 });
  }
  const patch = parse.data;

  const nextHook = patch.hook ?? existing.hook;
  const nextBody = patch.body ?? existing.body;
  const nextCta = patch.cta ?? existing.cta;

  const existingMetadata = (existing.metadata as Record<string, unknown> | null) ?? {};
  let nextMetadata = existingMetadata;
  if (patch.metadata) {
    nextMetadata = { ...existingMetadata, ...patch.metadata };
    if (patch.metadata.hashtags) {
      nextMetadata = { ...nextMetadata, hashtags: dedupeHashtags(patch.metadata.hashtags) };
    }
  }

  const warnings = buildWarnings({
    hook: nextHook,
    body: nextBody,
    cta: nextCta,
    beats: (existing.visualBeats as Array<{ start: number; end: number }> | null) ?? [],
    targetLengthSec: existing.idea.targetLengthSec,
  });

  const updated = await db.script.update({
    where: { id },
    data: {
      hook: nextHook,
      body: nextBody,
      cta: nextCta,
      metadata: nextMetadata as never,
      warnings: (warnings.length > 0 ? warnings : null) as never,
      lastEditedAt: new Date(),
    },
  });

  let rescoreJobId: string | null = null;
  const hookChanged = patch.hook !== undefined && shouldRescore(existing.hook, nextHook);
  const bodyChanged = patch.body !== undefined && shouldRescore(existing.body, nextBody);
  if (hookChanged || bodyChanged) {
    const job = await db.job.create({
      data: {
        type: "rescore_script",
        status: "queued",
        targetType: "Script",
        targetId: id,
        payload: { scriptId: id },
      },
    });
    rescoreJobId = job.id;
    enqueueAndRun(job.id);
  }

  return NextResponse.json({ script: updated, rescoreJobId });
}
