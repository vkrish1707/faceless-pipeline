import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { synthesize } from "../../packages/tts/src/piper";
import { transcribe } from "../../packages/captions/src/whisper";

const VOICE_MODEL = resolve("assets/voices/en_US-ryan-high.onnx");
const WHISPER_MODEL = resolve("assets/whisper/ggml-base.en.bin");
const OUT_DIR = resolve("output/_smoke");
const AUDIO_OUT = resolve(OUT_DIR, "audio.wav");
const CAPTIONS_OUT = resolve(OUT_DIR, "captions.json");

// 30+ word fixture script — matches the spec's smoke target.
const FIXTURE_TEXT =
  "Compound interest is the eighth wonder of the world. " +
  "Time is the silent partner of every dollar you invest. " +
  "Start small, stay consistent, and let the curve do its work for you, " +
  "because the first decade looks slow but the last decade looks like magic.";

function fail(reason: string): never {
  console.error(`FAIL: ${reason}`);
  process.exit(1);
}

function skip(reason: string): never {
  console.log(`SKIP: phase4-hello (${reason})`);
  process.exit(0);
}

async function main() {
  if (!existsSync(VOICE_MODEL)) {
    skip(`voice model not installed at ${VOICE_MODEL}. Run \`pnpm setup:piper\` to install it.`);
  }
  if (!existsSync(WHISPER_MODEL)) {
    skip(`whisper model not installed at ${WHISPER_MODEL}. Run \`pnpm setup:whisper\` to install it.`);
  }

  await fs.mkdir(OUT_DIR, { recursive: true });

  console.log(`==> piper synthesize ${FIXTURE_TEXT.split(/\s+/).length} words...`);
  const t0 = Date.now();
  await synthesize(FIXTURE_TEXT, { modelPath: VOICE_MODEL, outputPath: AUDIO_OUT });
  const synthMs = Date.now() - t0;
  const stat = await fs.stat(AUDIO_OUT);
  console.log(`    wrote ${AUDIO_OUT} (${stat.size} bytes) in ${synthMs}ms`);
  if (stat.size < 20 * 1024) {
    fail(`audio.wav too small: ${stat.size} bytes (< 20 KB)`);
  }

  console.log(`==> whisper transcribe ${AUDIO_OUT}...`);
  const t1 = Date.now();
  const captions = await transcribe(AUDIO_OUT, {
    modelPath: WHISPER_MODEL,
    outputJsonPath: CAPTIONS_OUT,
  });
  const transMs = Date.now() - t1;
  console.log(`    got ${captions.words.length} words in ${transMs}ms`);
  if (captions.words.length < 25) {
    fail(`expected >= 25 words in captions, got ${captions.words.length}`);
  }

  console.log(
    `OK: phase4-hello passed (synth ${synthMs}ms, transcribe ${transMs}ms, total ${synthMs + transMs}ms)`
  );
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
