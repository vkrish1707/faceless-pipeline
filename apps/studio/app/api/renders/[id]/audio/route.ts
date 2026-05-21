import { NextResponse } from "next/server";
import { promises as fsPromises, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const render = await db.render.findUnique({ where: { id } });
  if (!render || !render.audioPath) {
    return NextResponse.json({ error: "render not found" }, { status: 404 });
  }

  let stat;
  try {
    stat = await fsPromises.stat(render.audioPath);
  } catch {
    return NextResponse.json({ error: "audio file missing on disk" }, { status: 410 });
  }
  const size = stat.size;

  const range = req.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const startStr = match[1] ?? "";
    const endStr = match[2] ?? "";
    let start: number;
    let end: number;
    if (startStr === "" && endStr === "") {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    } else if (startStr === "") {
      // suffix length form: bytes=-N -> last N bytes
      const suffix = Number(endStr);
      start = Math.max(0, size - suffix);
      end = size - 1;
    } else {
      start = Number(startStr);
      end = endStr === "" ? size - 1 : Number(endStr);
    }
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end >= size ||
      start > end
    ) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }

    const chunkLength = end - start + 1;
    const nodeStream = createReadStream(render.audioPath, { start, end });
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
    return new NextResponse(webStream, {
      status: 206,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(chunkLength),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=60",
      },
    });
  }

  // Full body
  const nodeStream = createReadStream(render.audioPath);
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
  return new NextResponse(webStream, {
    status: 200,
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=60",
    },
  });
}
