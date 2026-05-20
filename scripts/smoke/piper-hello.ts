import { synthesize } from "../../packages/tts/src/piper";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";

const MODEL = resolve("assets/voices/en_US-ryan-high.onnx");
const OUT = resolve("output/_smoke/piper-hello.wav");

async function main() {
  await fs.mkdir("output/_smoke", { recursive: true });
  const t0 = Date.now();
  await synthesize("This is a Piper text to speech smoke test.", { modelPath: MODEL, outputPath: OUT });
  const stat = await fs.stat(OUT);
  console.log(`wrote ${OUT} (${stat.size} bytes) in ${Date.now() - t0}ms`);
  if (stat.size < 5000) {
    console.error("FAIL: wav too small");
    process.exit(1);
  }
  console.log("OK: piper-hello passed");
}
main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
