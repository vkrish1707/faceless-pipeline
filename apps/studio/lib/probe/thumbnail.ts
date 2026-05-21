import { spawn as defaultSpawn, type ChildProcess } from "node:child_process";

/**
 * Single-frame thumbnail extraction via ffmpeg. We use `-ss <atSec> -i <src>
 * -vframes 1 -y <out>` which is the canonical "fast snapshot" form (seek
 * before input keeps it cheap, -y overwrites without prompting).
 *
 * Tests inject `spawnImpl` so we can assert the exact arg list without ever
 * launching ffmpeg.
 */

export type ExtractThumbnailOpts = {
  srcPath: string;
  outPath: string;
  atSec?: number;
  spawnImpl?: (cmd: string, args: ReadonlyArray<string>) => ChildProcess;
  ffmpegBin?: string;
};

export function buildFfmpegThumbnailArgs(
  srcPath: string,
  outPath: string,
  atSec: number
): string[] {
  return ["-ss", String(atSec), "-i", srcPath, "-vframes", "1", "-y", outPath];
}

export async function extractThumbnail(opts: ExtractThumbnailOpts): Promise<void> {
  const spawnImpl = opts.spawnImpl ?? (defaultSpawn as ExtractThumbnailOpts["spawnImpl"])!;
  const bin = opts.ffmpegBin ?? "ffmpeg";
  const atSec = opts.atSec ?? 1;
  const args = buildFfmpegThumbnailArgs(opts.srcPath, opts.outPath, atSec);

  await new Promise<void>((resolveP, rejectP) => {
    const proc = spawnImpl(bin, args);
    let stderr = "";
    proc.stderr?.on("data", (d) => (stderr += d.toString()));
    proc.on("error", rejectP);
    proc.on("close", (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`ffmpeg thumbnail exited ${code}: ${stderr || "(no stderr)"}`));
    });
  });
}
