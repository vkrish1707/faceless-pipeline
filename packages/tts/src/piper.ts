import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";

export type PiperOpts = {
  modelPath: string;
  outputPath: string;
  /** Path to the piper executable. Defaults to PIPER_BIN env or assets/piper-venv/bin/piper. */
  piperBin?: string;
};

export function buildPiperArgs(opts: Pick<PiperOpts, "modelPath" | "outputPath">): string[] {
  return ["--model", opts.modelPath, "--output_file", opts.outputPath];
}

function resolvePiperBin(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.PIPER_BIN) return process.env.PIPER_BIN;
  return resolve(process.cwd(), "assets/piper-venv/bin/piper");
}

export async function synthesize(text: string, opts: PiperOpts): Promise<{ outputPath: string; durationMs: number }> {
  const t0 = Date.now();
  await fs.mkdir(dirname(opts.outputPath), { recursive: true });

  const bin = resolvePiperBin(opts.piperBin);

  await new Promise<void>((resolveP, rejectP) => {
    const proc = spawn(bin, buildPiperArgs(opts));
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", rejectP);
    proc.on("close", (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`piper exited ${code}: ${stderr}`));
    });
    proc.stdin.end(text);
  });

  return { outputPath: opts.outputPath, durationMs: Date.now() - t0 };
}
