/**
 * ffmpeg invocation wrapper for the background-music mix. Splits the
 * argv-building (pure, tested in mixArgs.test.ts) from the spawn so the
 * subprocess layer can be stubbed in handler tests.
 */

import { spawn as defaultSpawn, type ChildProcess } from "node:child_process";
import { buildMixArgs, DEFAULT_GAIN_DB } from "./mixArgs";

export type SpawnFn = (
  cmd: string,
  args: ReadonlyArray<string>,
  opts?: { env?: NodeJS.ProcessEnv }
) => ChildProcess;

export interface MixAudioInput {
  videoPath: string;
  musicPath: string;
  outPath: string;
  gainDb?: number;
  spawnImpl?: SpawnFn;
}

export class FfmpegMixError extends Error {
  exitCode: number | null;
  stderr: string;
  constructor(exitCode: number | null, stderr: string) {
    super(`ffmpeg exited ${exitCode}: ${stderr.slice(0, 4096)}`);
    this.name = "FfmpegMixError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/**
 * Run ffmpeg to overlay `musicPath` onto `videoPath`, producing
 * `outPath`. Rejects with `FfmpegMixError` (carrying stderr) on a non-zero
 * exit so the render orchestrator can preserve the original video and
 * record the warning.
 */
export function mixAudio(input: MixAudioInput): Promise<void> {
  const spawnImpl = input.spawnImpl ?? (defaultSpawn as SpawnFn);
  const argv = buildMixArgs({
    videoPath: input.videoPath,
    musicPath: input.musicPath,
    outPath: input.outPath,
    gainDb: input.gainDb ?? DEFAULT_GAIN_DB,
  });
  return new Promise<void>((resolve, reject) => {
    const proc = spawnImpl("ffmpeg", argv);
    let stderr = "";
    proc.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new FfmpegMixError(code ?? null, stderr));
    });
  });
}
