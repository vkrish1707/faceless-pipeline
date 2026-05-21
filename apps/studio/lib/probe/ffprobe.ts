import { spawn as defaultSpawn, type ChildProcess } from "node:child_process";

/**
 * Thin ffprobe wrapper that captures the stream summary from
 * `ffprobe -v error -print_format json -show_format -show_streams <path>`
 * and reduces it to a small `ProbeResult`. Pure aside from spawning the
 * binary, so it accepts a `spawnImpl` for tests.
 */

export type ProbeResult = {
  width: number;
  height: number;
  durationSec: number;
  codec: string;
  hasAudio: boolean;
};

export type SpawnLike = (
  cmd: string,
  args: ReadonlyArray<string>
) => ChildProcess;

export type ProbeOpts = {
  spawnImpl?: SpawnLike;
  ffprobeBin?: string;
};

export function buildFfprobeArgs(path: string): string[] {
  return [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    path,
  ];
}

type Stream = {
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
};
type FfprobeJson = {
  streams?: Stream[];
  format?: { duration?: string };
};

export function parseFfprobeJson(raw: FfprobeJson): ProbeResult {
  const streams = raw.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  if (!video) {
    throw new Error("ffprobe: no video stream found");
  }
  const durationStr = raw.format?.duration ?? video.duration ?? "0";
  const durationSec = Number(durationStr);
  return {
    width: Number(video.width ?? 0),
    height: Number(video.height ?? 0),
    durationSec: Number.isFinite(durationSec) ? durationSec : 0,
    codec: video.codec_name ?? "",
    hasAudio: !!audio,
  };
}

export async function probeMedia(
  path: string,
  opts: ProbeOpts = {}
): Promise<ProbeResult> {
  const spawnImpl = opts.spawnImpl ?? (defaultSpawn as SpawnLike);
  const bin = opts.ffprobeBin ?? "ffprobe";

  return new Promise<ProbeResult>((resolveP, rejectP) => {
    const proc = spawnImpl(bin, buildFfprobeArgs(path));
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => (stdout += d.toString()));
    proc.stderr?.on("data", (d) => (stderr += d.toString()));
    proc.on("error", rejectP);
    proc.on("close", (code) => {
      if (code !== 0) {
        rejectP(new Error(`ffprobe exited ${code}: ${stderr || "(no stderr)"}`));
        return;
      }
      try {
        const json = JSON.parse(stdout) as FfprobeJson;
        resolveP(parseFfprobeJson(json));
      } catch (err) {
        rejectP(new Error(`ffprobe: failed to parse JSON: ${(err as Error).message}`));
      }
    });
  });
}
