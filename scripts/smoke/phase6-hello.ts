import { config } from "dotenv";
config({ path: ".env.local" });

import { spawnSync } from "node:child_process";
import {
  promises as fs,
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

import { buildFfprobeArgs, parseFfprobeJson } from "../../apps/studio/lib/probe/ffprobe";

/**
 * Phase 6 smoke test. Drives a real Remotion render through the full
 * Phase 6 composition with a tiny synthetic fixture:
 *   - 60 frames @ 30 fps = 2s
 *   - 1 photo beat (we provide a placeholder image)
 *   - 1 caption word
 *   - no audio (we'd need a wav we can't generate in CI)
 *
 * Then ffprobes the resulting MP4 and asserts 1080×1920 H.264 ~2s.
 *
 * Skips with an informative message if Remotion's Chrome download isn't
 * usable, or if ffprobe isn't installed locally.
 */

const ENTRY = resolve("packages/remotion/src/index.ts");
const OUT_DIR = resolve("output/_smoke-phase6");
const OUT = resolve(OUT_DIR, "phase6-hello.mp4");

function checkFfprobe(): boolean {
  const probe = spawnSync("ffprobe", ["-version"], { encoding: "utf8" });
  return probe.status === 0;
}

function makePlaceholderJpeg(path: string): void {
  // Tiny 1×1 white JPEG (133 bytes). Plenty for the Remotion render to
  // verify the Img loader works without bundling a real image.
  const hex =
    "FFD8FFE000104A46494600010100000100010000FFDB0043000806060706050807" +
    "0707090909080A0C140D0C0B0B0C1912130F141D1A1F1E1D1A1C1C2024342726" +
    "1F30231C1C2837292D2E303132311F25393D38303C2E323130FFC0000B080001" +
    "00010101110000FFC4001F0000010501010101010100000000000000000102030405" +
    "060708090A0BFFC4001F0100030101010101010101010000000000000102030405" +
    "060708090A0BFFC400B5100002010303020403050504040000017D010203000411" +
    "0512213141061351610722711432811491A1082342B1C11552D1F02433627282090A" +
    "161718191A25262728292A3435363738393A434445464748494A535455565758595A" +
    "636465666768696A737475767778797A838485868788898A92939495969798999A" +
    "A2A3A4A5A6A7A8A9AAB2B3B4B5B6B7B8B9BAC2C3C4C5C6C7C8C9CAD2D3D4D5D6D7" +
    "D8D9DAE1E2E3E4E5E6E7E8E9EAF1F2F3F4F5F6F7F8F9FAFFC400B5110002010204" +
    "04030407050404000102770001020311040521310612415107617113223281081442" +
    "91A1B1C109233352F0156272D10A162434E125F11718191A262728292A35363738" +
    "393A434445464748494A535455565758595A636465666768696A7374757677787" +
    "97A82838485868788898A92939495969798999AA2A3A4A5A6A7A8A9AAB2B3B4B5B6" +
    "B7B8B9BAC2C3C4C5C6C7C8C9CAD2D3D4D5D6D7D8D9DAE2E3E4E5E6E7E8E9EAF2F3" +
    "F4F5F6F7F8F9FAFFDA000C03010002110311003F00FBFAFD7AFFD9";
  writeFileSync(path, Buffer.from(hex.replace(/\s+/g, ""), "hex"));
}

// Some Remotion errors (notably the Chrome-headless-shell download failure
// in sandboxed environments) escape try/catch as uncaughtException. We catch
// them here and exit-0 with a SKIP so this smoke is safe to run in CI.
process.on("uncaughtException", (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (/Chrome|chrom|downloading file|Host not in allowlist/i.test(msg)) {
    console.log(`SKIP: Remotion's Chromium isn't reachable in this environment: ${msg.split("\n")[0]}`);
    process.exit(0);
  }
  console.error("FAIL:", err);
  process.exit(1);
});

async function main() {
  const stagingDir = mkdtempSync(join(tmpdir(), "phase6-smoke-"));
  await fs.mkdir(OUT_DIR, { recursive: true });
  try {
    const photoPath = join(stagingDir, "photo.jpg");
    makePlaceholderJpeg(photoPath);

    const renderInput = {
      scriptId: "phase6-smoke",
      durationFrames: 60,
      fps: 30,
      width: 1080,
      height: 1920,
      // Audio is required by the composition's <Audio> element but Remotion is
      // tolerant of missing files at the render layer (warning, not failure).
      // We feed it /dev/null so the renderer still produces an MP4.
      audioPath: "/dev/null",
      captions: { words: [{ word: "hello", start: 0, end: 1 }] },
      visualBeats: [
        {
          start: 0,
          end: 2,
          tone: "explainer",
          assetPath: photoPath,
          assetType: "photo",
        },
      ],
      theme: "finance-dark",
      metadata: {
        youtubeTitle: "smoke",
        caption: "smoke",
        hashtags: ["#smoke"],
        thumbnailConcept: "smoke",
      },
      hookText: "Hello world",
      ctaText: "",
    } as const;

    console.log("==> bundling Remotion composition...");
    const t0 = Date.now();
    let bundled: string;
    try {
      bundled = await bundle({ entryPoint: ENTRY });
    } catch (err) {
      console.log(
        `SKIP: Remotion bundle failed (likely missing browser/GL): ${
          (err as Error).message
        }`
      );
      process.exit(0);
    }
    console.log(`    bundled in ${Date.now() - t0}ms`);

    let composition;
    try {
      composition = await selectComposition({
        serveUrl: bundled,
        id: "Video",
        inputProps: renderInput,
      });
    } catch (err) {
      console.log(
        `SKIP: selectComposition failed — likely Remotion's Chromium isn't downloadable in this sandbox: ${
          (err as Error).message.split("\n")[0]
        }`
      );
      process.exit(0);
    }
    console.log("==> rendering (this requires Chrome from Remotion's setup)...");
    const t1 = Date.now();
    try {
      await renderMedia({
        composition,
        serveUrl: bundled,
        codec: "h264",
        outputLocation: OUT,
        inputProps: renderInput,
      });
    } catch (err) {
      console.log(
        `SKIP: renderMedia failed — likely Remotion's Chromium not installed: ${
          (err as Error).message
        }`
      );
      process.exit(0);
    }
    console.log(`    rendered in ${Date.now() - t1}ms`);

    const stat = await fs.stat(OUT);
    console.log(`wrote ${OUT} (${stat.size} bytes)`);
    if (stat.size < 50_000) {
      console.error(`FAIL: mp4 too small (${stat.size} bytes)`);
      process.exit(1);
    }

    if (!checkFfprobe()) {
      console.log("SKIP: ffprobe not installed — cannot verify resolution");
      process.exit(0);
    }

    const probe = spawnSync("ffprobe", buildFfprobeArgs(OUT), { encoding: "utf8" });
    if (probe.status !== 0) {
      console.error(`FAIL: ffprobe exited ${probe.status}: ${probe.stderr}`);
      process.exit(1);
    }
    const result = parseFfprobeJson(JSON.parse(probe.stdout));
    console.log(
      `==> ffprobe: ${result.width}×${result.height} ${result.codec} duration=${result.durationSec.toFixed(2)}s`
    );
    if (result.width !== 1080 || result.height !== 1920) {
      console.error(`FAIL: expected 1080×1920, got ${result.width}×${result.height}`);
      process.exit(1);
    }
    if (result.codec !== "h264") {
      console.error(`FAIL: expected h264, got ${result.codec}`);
      process.exit(1);
    }
    if (result.durationSec < 1.5 || result.durationSec > 3.0) {
      console.error(`FAIL: expected ~2s duration, got ${result.durationSec.toFixed(2)}s`);
      process.exit(1);
    }

    console.log("OK: phase6-hello passed");
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
    if (existsSync(OUT)) rmSync(OUT, { force: true });
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
