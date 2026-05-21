import { NextResponse } from "next/server";
import { createReadStream, statSync, existsSync } from "node:fs";
import { extname } from "node:path";
import { db } from "@/lib/db";
import { contentTypeForExt } from "@studio/assets";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await db.asset.findUnique({ where: { id } });
  if (!asset) return NextResponse.json({ error: "asset not found" }, { status: 404 });
  if (!existsSync(asset.localPath)) {
    return NextResponse.json({ error: "file gone from disk" }, { status: 410 });
  }

  const stat = statSync(asset.localPath);
  const total = stat.size;
  const ext = extname(asset.localPath).toLowerCase();
  const contentType = contentTypeForExt(ext) ?? "application/octet-stream";

  const range = req.headers.get("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
    }
    const startStr = m[1]!;
    const endStr = m[2]!;
    const start = startStr === "" ? Math.max(0, total - Number.parseInt(endStr || "0", 10)) : Number.parseInt(startStr, 10);
    const end = endStr === "" ? total - 1 : Math.min(total - 1, Number.parseInt(endStr, 10));
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start < 0 || end >= total) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
    }
    const chunkSize = end - start + 1;
    const stream = createReadStream(asset.localPath, { start, end });
    return new NextResponse(stream as unknown as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(chunkSize),
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  const stream = createReadStream(asset.localPath);
  return new NextResponse(stream as unknown as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(total),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
