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

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const result = await db.$transaction(async (tx) => {
    const script = await tx.script.findUnique({ where: { id } });
    if (!script) return { error: "script not found", status: 404 } as const;

    const beats = (script.visualBeats as unknown as VisualBeat[]) ?? [];
    if (beats.length === 0) return { picked: 0 };

    const assets = await tx.asset.findMany({
      where: { scriptId: id, beatIndex: { not: null } },
      orderBy: [{ beatIndex: "asc" }, { id: "asc" }],
    });
    const firstByBeat = new Map<number, string>();
    for (const a of assets) {
      if (a.beatIndex == null) continue;
      if (!firstByBeat.has(a.beatIndex)) firstByBeat.set(a.beatIndex, a.id);
    }

    let picked = 0;
    const next: VisualBeat[] = beats.map((b, i) => {
      if (b.pickedAssetId) return b;
      const candidate = firstByBeat.get(i);
      if (!candidate) return b;
      picked += 1;
      return { ...b, pickedAssetId: candidate };
    });

    if (picked > 0) {
      await tx.script.update({
        where: { id },
        data: { visualBeats: next as unknown as object },
      });
      const now = new Date();
      const ids = next.map((b) => b.pickedAssetId).filter((x): x is string => !!x);
      if (ids.length > 0) {
        await tx.asset.updateMany({
          where: { id: { in: ids }, pickedAt: null },
          data: { pickedAt: now },
        });
      }
    }

    return { picked };
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
