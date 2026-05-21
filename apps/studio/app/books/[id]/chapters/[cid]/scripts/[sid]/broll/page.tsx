import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { BrollPicker, type BeatRow, type AssetCandidate } from "./BrollPicker";
import { BulkActions } from "./BulkActions";

export const dynamic = "force-dynamic";

type VisualBeat = {
  start: number;
  end: number;
  keywords: string[];
  mediaType: "photo" | "video";
  tone?: string;
  pickedAssetId?: string | null;
};

export default async function BrollPage({
  params,
}: {
  params: Promise<{ id: string; cid: string; sid: string }>;
}) {
  const { id, cid, sid } = await params;

  const script = await db.script.findUnique({
    where: { id: sid },
    include: { idea: { include: { chapter: { include: { book: true } } } } },
  });
  if (!script) notFound();
  if (script.idea.chapterId !== cid || script.idea.chapter.bookId !== id) notFound();

  const beats = (script.visualBeats as unknown as VisualBeat[]) ?? [];

  const assets = await db.asset.findMany({
    where: { scriptId: sid },
    orderBy: [{ beatIndex: "asc" }, { id: "asc" }],
  });

  const byBeat = new Map<number, AssetCandidate[]>();
  for (const a of assets) {
    if (a.beatIndex == null) continue;
    const list = byBeat.get(a.beatIndex) ?? [];
    list.push({
      id: a.id,
      type: a.type,
      thumbUrl: `/api/assets/${a.id}/file`,
      width: a.width,
      height: a.height,
      durationSec: a.durationSec,
      sourceUrl: a.sourceUrl,
    });
    byBeat.set(a.beatIndex, list);
  }

  const rows: BeatRow[] = beats.map((b, i) => ({
    beatIndex: i,
    start: b.start,
    end: b.end,
    keywords: b.keywords ?? [],
    mediaType: b.mediaType,
    tone: b.tone ?? "",
    pickedAssetId: b.pickedAssetId ?? null,
    candidates: byBeat.get(i) ?? [],
  }));

  return (
    <main className="max-w-6xl mx-auto p-8 space-y-6">
      <header className="space-y-2">
        <Link
          href={`/books/${id}/chapters/${cid}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← {script.idea.chapter.title}
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">B-roll picker</h1>
            <p className="text-muted-foreground text-sm">
              {script.idea.title} · {beats.length} beats ·{" "}
              {rows.filter((r) => r.pickedAssetId).length} / {beats.length} picked
            </p>
          </div>
          <BulkActions scriptId={sid} />
        </div>
      </header>

      <BrollPicker scriptId={sid} rows={rows} />
    </main>
  );
}
