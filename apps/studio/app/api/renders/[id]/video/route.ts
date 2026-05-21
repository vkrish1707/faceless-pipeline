import { NextResponse } from "next/server";
import { promises as fsPromises, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Streams the rendered MP4. Supports HTTP Range requests so the <video>
 * element can seek without re-downloading the entire file. Mirrors the
 * audio route's pattern from Phase 4.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const render = await db.render.findUnique({ where: { id } });
  if (!render || !render.videoPath) {
    return NextResponse.json({ error: "render not found" }, { status: 404 });
  }

  let stat;
  try {
    stat = await fsPromises.stat(render.videoPath);
  } catch {
    return NextResponse.json({ error: "video file missing on disk" }, { status: 410 });
  }
  const size = stat.size;

  const range = req.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
    const startStr = match[1] ?? "";
    const endStr = match[2] ?? "";
    let start: number;
    let end: number;
    if (startStr === "" && endStr === "") {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    } else if (startStr === "") {
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
    const nodeStream = createReadStream(render.videoPath, { start, end });
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
    return new NextResponse(webStream, {
      status: 206,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(chunkLength),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=60",
      },
    });
  }

  const nodeStream = createReadStream(render.videoPath);
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
  return new NextResponse(webStream, {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=60",
    },
  });
}
