import { transcribe } from "../../packages/captions/src/whisper";
import { resolve } from "node:path";
import { promises as fs } from "node:fs";

const MODEL = resolve("assets/whisper/ggml-small.en.bin");
const AUDIO = resolve("output/_smoke/piper-hello.wav");
const OUT = resolve("output/_smoke/whisper-hello.json");

async function main() {
  await fs.access(AUDIO).catch(() => {
    console.error(`FAIL: ${AUDIO} not found. Run 'pnpm smoke:piper' first.`);
    process.exit(1);
  });
  const t0 = Date.now();
  const result = await transcribe(AUDIO, { modelPath: MODEL, outputJsonPath: OUT });
  console.log(`got ${result.words.length} words in ${Date.now() - t0}ms`);
  console.log(result.words.slice(0, 6));
  if (result.words.length < 5) {
    console.error("FAIL: too few words");
    process.exit(1);
  }
  console.log("OK: whisper-hello passed");
}
main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
