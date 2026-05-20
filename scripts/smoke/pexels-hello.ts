import { config } from "dotenv";
config({ path: ".env.local" });
import { searchPhotos } from "../../packages/assets/src/pexels";

const apiKey = process.env.PEXELS_API_KEY;
if (!apiKey) {
  console.error("FAIL: PEXELS_API_KEY missing");
  process.exit(1);
}

async function main() {
  const t0 = Date.now();
  const results = await searchPhotos("compound interest", { apiKey, perPage: 5 });
  console.log(`got ${results.length} results in ${Date.now() - t0}ms`);
  for (const r of results) console.log(`  ${r.id}: ${r.alt} — ${r.thumb}`);
  if (results.length === 0) {
    console.error("FAIL: 0 results — check API key or query");
    process.exit(1);
  }
  console.log("OK: pexels-hello passed");
}
main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
