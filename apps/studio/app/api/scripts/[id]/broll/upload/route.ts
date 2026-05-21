import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeUpload } from "@/lib/uploads/manual";

export const dynamic = "force-dynamic";

type VisualBeat = {
  start: number;
  end: number;
  keywords: string[];
  mediaType: "photo" | "video";
  tone?: string;
  pickedAssetId?: string | null;
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const script = await db.script.findUnique({ where: { id } });
  if (!script) return NextResponse.json({ error: "script not found" }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return NextResponse.json({ error: `invalid multipart body: ${err instanceof Error ? err.message : err}` }, { status: 400 });
  }

  const beatIndexStr = form.get("beatIndex");
  if (typeof beatIndexStr !== "string") {
    return NextResponse.json({ error: "beatIndex required" }, { status: 400 });
  }
  const beatIndex = Number.parseInt(beatIndexStr, 10);
  if (!Number.isInteger(beatIndex) || beatIndex < 0) {
    return NextResponse.json({ error: "beatIndex must be a non-negative integer" }, { status: 400 });
  }

  const beats = (script.visualBeats as unknown as VisualBeat[]) ?? [];
  if (beatIndex >= beats.length) {
    return NextResponse.json({ error: `beatIndex ${beatIndex} out of range (${beats.length} beats)` }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  const declaredMime = (file as File).type || "application/octet-stream";
  const basename = (file as File).name || "upload";
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const written = await writeUpload({
      scriptId: id,
      beatIndex,
      basename,
      buffer,
      declaredMime,
    });

    const type = declaredMime.startsWith("video/") ? "manual_video" : "manual_photo";
    const asset = await db.asset.create({
      data: {
        scriptId: id,
        beatIndex,
        type,
        sourceUrl: null,
        localPath: written.localPath,
        thumbPath: written.localPath,
        keyword: null,
      },
    });

    // Auto-pick if beat has no current pick.
    const beat = beats[beatIndex]!;
    let autoPicked = false;
    if (!beat.pickedAssetId) {
      const next = beats.map((b, i) =>
        i === beatIndex ? { ...b, pickedAssetId: asset.id } : b
      );
      await db.script.update({
        where: { id },
        data: { visualBeats: next as unknown as object },
      });
      await db.asset.update({ where: { id: asset.id }, data: { pickedAt: new Date() } });
      autoPicked = true;
    }

    return NextResponse.json({ asset, autoPicked }, { status: 201 });
  } catch (err) {
    const code = (err as { code?: string }).code;
    const message = err instanceof Error ? err.message : String(err);
    if (code === "FILE_TOO_LARGE") return NextResponse.json({ error: message }, { status: 413 });
    if (code === "MIME_MISMATCH") return NextResponse.json({ error: message }, { status: 400 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
