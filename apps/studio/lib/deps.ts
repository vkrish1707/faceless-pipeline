import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";

export type DepCheck = { name: string; ok: boolean; path?: string; detail?: string };

export async function checkBinary(name: string): Promise<DepCheck> {
  return new Promise((resolveP) => {
    const proc = spawn("which", [name]);
    let stdout = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.on("close", (code) => {
      const path = stdout.trim();
      resolveP({ name, ok: code === 0 && path.length > 0, path: path || undefined });
    });
    proc.on("error", () => resolveP({ name, ok: false }));
  });
}

export async function checkFile(name: string, path: string): Promise<DepCheck> {
  try {
    const stat = await fs.stat(path);
    return { name, ok: stat.isFile(), path, detail: `${stat.size} bytes` };
  } catch {
    return { name, ok: false, path, detail: "missing" };
  }
}

export async function checkEnv(name: string, key: string, env: NodeJS.ProcessEnv): Promise<DepCheck> {
  const v = env[key];
  return { name, ok: !!v && v.length >= 10, detail: v ? "set" : "missing" };
}

export function summarize<T extends { ok: boolean }>(checks: ReadonlyArray<T>): "ok" | "degraded" {
  return checks.every((c) => c.ok) ? "ok" : "degraded";
}

export async function runAllChecks(env: NodeJS.ProcessEnv): Promise<{ status: "ok" | "degraded"; checks: DepCheck[] }> {
  const root = process.cwd();
  const checks = await Promise.all([
    checkEnv("ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", env),
    checkEnv("PEXELS_API_KEY", "PEXELS_API_KEY", env),
    checkFile("piper", resolve(root, "assets/piper-venv/bin/piper")),
    checkBinary("whisper-cli"),
    checkBinary("ffmpeg"),
    checkFile("voice:ryan", resolve(root, "assets/voices/en_US-ryan-high.onnx")),
    checkFile("voice:amy", resolve(root, "assets/voices/en_US-amy-medium.onnx")),
    checkFile("whisper:small.en", resolve(root, "assets/whisper/ggml-small.en.bin")),
  ]);
  return { status: summarize(checks), checks };
}
