import { NextResponse } from "next/server";
import { promises as fsPromises } from "node:fs";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const render = await db.render.findUnique({ where: { id } });
  if (!render) return NextResponse.json({ error: "render not found" }, { status: 404 });
  if (!render.captionsPath) {
    return NextResponse.json({ error: "captions not generated yet" }, { status: 404 });
  }

  let raw: string;
  try {
    raw = await fsPromises.readFile(render.captionsPath, "utf8");
  } catch {
    // Render says "done" but the captions JSON is gone — surface this so the
    // UI can prompt the user to regenerate.
    return NextResponse.json({ error: "captions file missing on disk" }, { status: 410 });
  }

  return new NextResponse(raw, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, max-age=60",
    },
  });
}
