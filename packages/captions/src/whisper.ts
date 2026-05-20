import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";

export type WordTiming = { word: string; start: number; end: number };
export type CaptionsResult = { words: WordTiming[] };

type WhisperSegment = { offsets: { from: number; to: number }; text: string };
type WhisperJson = { transcription: WhisperSegment[] };

export function parseWhisperJson(raw: WhisperJson): CaptionsResult {
  const words: WordTiming[] = [];
  for (const seg of raw.transcription) {
    const trimmed = (seg.text ?? "").trim();
    if (!trimmed) continue;
    words.push({
      word: trimmed,
      start: seg.offsets.from / 1000,
      end: seg.offsets.to / 1000,
    });
  }
  return { words };
}

export async function transcribe(
  audioPath: string,
  opts: { modelPath: string; outputJsonPath: string }
): Promise<CaptionsResult> {
  await new Promise<void>((resolveP, rejectP) => {
    const proc = spawn("whisper-cli", [
      "-m", opts.modelPath,
      "--output-json",
      "--max-len", "1",
      "-f", audioPath,
      "-of", opts.outputJsonPath.replace(/\.json$/, ""),
    ]);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", rejectP);
    proc.on("close", (code) => (code === 0 ? resolveP() : rejectP(new Error(`whisper exited ${code}: ${stderr}`))));
  });

  const raw = JSON.parse(await fs.readFile(opts.outputJsonPath, "utf8")) as WhisperJson;
  return parseWhisperJson(raw);
}
