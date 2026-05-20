import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { resolve } from "node:path";
import { promises as fs } from "node:fs";

const ENTRY = resolve("packages/remotion/src/index.ts");
const OUT_DIR = resolve("output/_smoke");
const OUT = resolve(OUT_DIR, "remotion-hello.mp4");

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  console.log("==> bundling...");
  const t0 = Date.now();
  const bundled = await bundle({ entryPoint: ENTRY });
  console.log(`    bundled in ${Date.now() - t0}ms`);

  const composition = await selectComposition({ serveUrl: bundled, id: "HelloVideo" });
  console.log("==> rendering...");
  const t1 = Date.now();
  await renderMedia({
    composition,
    serveUrl: bundled,
    codec: "h264",
    outputLocation: OUT,
  });
  console.log(`    rendered in ${Date.now() - t1}ms`);
  const stat = await fs.stat(OUT);
  console.log(`wrote ${OUT} (${stat.size} bytes)`);
  if (stat.size < 10000) {
    console.error("FAIL: mp4 too small");
    process.exit(1);
  }
  console.log("OK: remotion-hello passed");
}
main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
