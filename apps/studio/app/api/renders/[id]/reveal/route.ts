import { NextResponse } from "next/server";
import path from "node:path";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Best-effort "reveal in Finder" for macOS. Other platforms get a silent 204
 * — the UI button is still useful as a no-op on Windows/Linux dev machines.
 *
 * We don't await spawn or capture its exit; the harness fires-and-forgets so
 * the Finder open can finish on its own time.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const render = await db.render.findUnique({ where: { id } });
  if (!render || !render.videoPath) {
    return new NextResponse(null, { status: 204 });
  }

  const bundleDir = path.dirname(render.videoPath);
  if (!existsSync(bundleDir)) {
    return new NextResponse(null, { status: 204 });
  }

  if (process.platform === "darwin") {
    try {
      const proc = spawn("open", [bundleDir], { detached: true, stdio: "ignore" });
      proc.unref();
    } catch {
      // ignore — non-fatal best-effort
    }
  }

  return new NextResponse(null, { status: 204 });
}
