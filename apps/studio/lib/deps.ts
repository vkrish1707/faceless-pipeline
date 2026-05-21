import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";

export type DepCheck = { name: string; ok: boolean; path?: string; detail?: string; help?: string };
export type DepGroup = { name: string; checks: DepCheck[]; status: "ok" | "degraded" };

export async function checkBinary(name: string, help?: string): Promise<DepCheck> {
  return new Promise((resolveP) => {
    const proc = spawn("which", [name]);
    let stdout = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.on("close", (code) => {
      const path = stdout.trim();
      resolveP({ name, ok: code === 0 && path.length > 0, path: path || undefined, help });
    });
    proc.on("error", () => resolveP({ name, ok: false, help }));
  });
}

export async function checkFile(name: string, path: string, help?: string): Promise<DepCheck> {
  try {
    const stat = await fs.stat(path);
    return { name, ok: stat.isFile(), path, detail: `${stat.size} bytes` };
  } catch {
    return { name, ok: false, path, detail: "missing", help };
  }
}

export async function checkEnv(name: string, key: string, env: NodeJS.ProcessEnv, help?: string): Promise<DepCheck> {
  const v = env[key];
  return { name, ok: !!v && v.length >= 10, detail: v ? "set" : "missing", help };
}

export function summarize<T extends { ok: boolean }>(checks: ReadonlyArray<T>): "ok" | "degraded" {
  return checks.every((c) => c.ok) ? "ok" : "degraded";
}

function findWorkspaceRoot(start: string = process.cwd()): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  return start;
}

const MUSIC_TRACKS = [
  "urgent_pulse.mp3",
  "calm_focus.mp3",
  "motivational_lift.mp3",
  "neutral_groove.mp3",
  "cinematic_swell.mp3",
];

export async function runAllChecks(
  env: NodeJS.ProcessEnv
): Promise<{ status: "ok" | "degraded"; groups: DepGroup[] }> {
  const root = findWorkspaceRoot();

  const apiKeys: DepCheck[] = await Promise.all([
    checkEnv("ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", env, "Set in .env.local. Required for scoring + scripts."),
    checkEnv("PEXELS_API_KEY", "PEXELS_API_KEY", env, "Set in .env.local. Required for b-roll fetching."),
  ]);

  const binaries: DepCheck[] = await Promise.all([
    checkFile(
      "piper",
      resolve(root, "assets/piper-venv/bin/piper"),
      "Run `pnpm setup:piper` to install Piper TTS."
    ),
    checkBinary("whisper-cli", "Run `pnpm setup:whisper` to install whisper.cpp."),
    checkBinary("ffmpeg", "Install via `brew install ffmpeg` (macOS) — required for render + bg-music mix."),
    checkBinary("ffprobe", "Comes with ffmpeg; same install."),
  ]);

  const models: DepCheck[] = await Promise.all([
    checkFile(
      "voice:ryan",
      resolve(root, "assets/voices/en_US-ryan-high.onnx"),
      "Run `pnpm setup:piper` (downloads en_US-ryan-high.onnx)."
    ),
    checkFile(
      "voice:amy",
      resolve(root, "assets/voices/en_US-amy-medium.onnx"),
      "Optional. Download from Piper's HuggingFace bundle."
    ),
    checkFile(
      "whisper:small.en",
      resolve(root, "assets/whisper/ggml-small.en.bin"),
      "Run `pnpm setup:whisper` (downloads ggml-small.en.bin)."
    ),
  ]);

  const music: DepCheck[] = await Promise.all(
    MUSIC_TRACKS.map((file) =>
      checkFile(
        `music:${file.replace(".mp3", "")}`,
        resolve(root, "assets/music", file),
        "Drop a royalty-free MP3 (~30-60s loop) at this path. See assets/music/README.md."
      )
    )
  );

  const groups: DepGroup[] = [
    { name: "API keys", checks: apiKeys, status: summarize(apiKeys) },
    { name: "Binaries", checks: binaries, status: summarize(binaries) },
    { name: "Models", checks: models, status: summarize(models) },
    { name: "Background music (optional)", checks: music, status: summarize(music) },
  ];

  // Music tracks are optional — they don't block the overall status.
  const required = groups.slice(0, 3);
  const status = summarize(required.flatMap((g) => g.checks));

  return { status, groups };
}
