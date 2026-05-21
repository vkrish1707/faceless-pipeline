import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type VisualBeat = {
  start: number;
  end: number;
  keywords: string[];
  mediaType: "photo" | "video";
  tone?: string;
  pickedAssetId?: string | null;
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; idx: string }> }
) {
  const { id, idx } = await params;
  const beatIndex = Number.parseInt(idx, 10);
  if (!Number.isInteger(beatIndex) || beatIndex < 0) {
    return NextResponse.json({ error: "beat index must be a non-negative integer" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as { pickedAssetId?: string | null; keywords?: string[] } | null;
  if (!body) {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const script = await db.script.findUnique({ where: { id } });
  if (!script) return NextResponse.json({ error: "script not found" }, { status: 404 });
  const beats = (script.visualBeats as unknown as VisualBeat[]) ?? [];
  if (beatIndex >= beats.length) {
    return NextResponse.json({ error: `beat ${beatIndex} out of range` }, { status: 404 });
  }

  const beat = { ...beats[beatIndex]! };

  if ("pickedAssetId" in body) {
    const pickedAssetId = body.pickedAssetId ?? null;
    if (pickedAssetId) {
      const asset = await db.asset.findUnique({ where: { id: pickedAssetId } });
      if (!asset) {
        return NextResponse.json({ error: `asset ${pickedAssetId} not found` }, { status: 400 });
      }
      if (asset.scriptId !== id) {
        return NextResponse.json({ error: "asset does not belong to this script" }, { status: 400 });
      }
      if (asset.beatIndex !== beatIndex) {
        return NextResponse.json(
          { error: `asset.beatIndex=${asset.beatIndex} does not match url beat ${beatIndex}` },
          { status: 400 }
        );
      }
      beat.pickedAssetId = pickedAssetId;
    } else {
      beat.pickedAssetId = null;
    }
  }

  if (Array.isArray(body.keywords)) {
    const kw = body.keywords.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim());
    if (kw.length === 0) {
      return NextResponse.json({ error: "keywords cannot be empty" }, { status: 400 });
    }
    beat.keywords = kw.slice(0, 5);
  }

  const next = beats.map((b, i) => (i === beatIndex ? beat : b));
  await db.script.update({
    where: { id },
    data: { visualBeats: next as unknown as object },
  });

  if (beat.pickedAssetId) {
    await db.asset.update({
      where: { id: beat.pickedAssetId },
      data: { pickedAt: new Date() },
    });
  }

  return NextResponse.json({ ok: true, beat });
}
