import { config } from "dotenv";
config({ path: ".env.local" });
import { mkdtempSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchPhotos, searchVideos, downloadAsset } from "../../packages/assets/src";

const apiKey = process.env.PEXELS_API_KEY;
if (!apiKey) {
  console.log("SKIP: PEXELS_API_KEY missing — set it in .env.local to run this smoke test.");
  process.exit(0);
}

async function main() {
  const dest = mkdtempSync(join(tmpdir(), "phase5-smoke-"));
  try {
    const t0 = Date.now();
    const photos = await searchPhotos("compound interest", { apiKey: apiKey!, perPage: 10 });
    console.log(`==> photo search: got ${photos.length} results in ${Date.now() - t0}ms`);
    if (photos.length < 5) {
      console.error(`FAIL: expected >=5 photo results, got ${photos.length}`);
      process.exit(1);
    }

    const t1 = Date.now();
    const videos = await searchVideos("forest aerial", { apiKey: apiKey!, perPage: 5 });
    console.log(`==> video search: got ${videos.length} results in ${Date.now() - t1}ms`);
    if (videos.length < 1) {
      console.error(`FAIL: expected >=1 video result, got ${videos.length}`);
      process.exit(1);
    }

    const firstThumb = photos[0]?.thumb;
    if (!firstThumb) {
      console.error("FAIL: first photo had no thumb URL");
      process.exit(1);
    }

    const t2 = Date.now();
    const out = await downloadAsset({ url: firstThumb, destDir: dest });
    const size = statSync(out.localPath).size;
    console.log(`==> downloaded ${out.localPath} (${size} bytes) in ${Date.now() - t2}ms`);
    if (size < 2048) {
      console.error(`FAIL: downloaded thumb is too small: ${size} bytes`);
      process.exit(1);
    }

    console.log("OK: phase5-hello passed");
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
