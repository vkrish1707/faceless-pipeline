import { config } from "dotenv";
config({ path: ".env.local" });
import { parsePdf, detectChapters } from "../../packages/parsers/src";
import { makeFixturePdf } from "../../packages/parsers/src/fixtures";
import { extractIdeas } from "../../packages/pipeline/src";

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("FAIL: ANTHROPIC_API_KEY missing");
    process.exit(1);
  }

  const finance = `Chapter 1
The Power of Compound Interest

Compound interest is the eighth wonder of the world. He who understands it, earns it; he who doesn't, pays it. A small amount invested early outperforms a large amount invested late because of doubling time. Consider two savers: Anna who invests $300/month from age 25 to 35 then stops, and Bob who invests $300/month from age 35 to 65. By age 65, Anna ends up with more money than Bob despite contributing for only ten years. The reason is that her early dollars have more years to double. Time, not amount, is the primary lever. Most investors get this exactly backwards.

The doubling rule of 72 makes this concrete: at 7% returns, money doubles every 10.3 years. At 10%, every 7.2 years. The first double matters less than the last double, because the last double is a much bigger absolute amount. This is why compounding feels slow at first and then accelerates.

Chapter 2
Why Index Funds Win

Active managers underperform their benchmark over 10-year windows in roughly 85% of cases. The reasons are well-documented: fees compound, market timing fails, and concentration risk punishes most managers eventually. The S&P 500 has returned an average of about 10% nominally over the long run, and a low-fee index fund captures that with almost no effort. Investors who try to beat the market typically end up paying more in fees and taxes than they earn in alpha.

A simple three-fund portfolio — total US, total international, and total bond — beats most professionally-managed retirement accounts after fees. The hardest part isn't picking the funds; it's staying the course during a 30% drawdown.`.repeat(2);

  console.log("==> parsing synthetic PDF...");
  const buf = await makeFixturePdf([finance]);
  const parsed = await parsePdf(buf);
  console.log(`    ${parsed.pageCount} pages`);

  const chapters = detectChapters(parsed.pages);
  console.log(`==> detected ${chapters.length} chapters`);
  if (chapters.length === 0) {
    console.error("FAIL: 0 chapters detected");
    process.exit(1);
  }

  const target = chapters[0]!;
  console.log(`==> extracting ideas from "${target.title}" (${target.rawText.length} chars)...`);
  const t0 = Date.now();
  const result = await extractIdeas({ chapterText: target.rawText, apiKey });
  console.log(`    got ${result.ideas.length} ideas in ${Date.now() - t0}ms`);
  console.log(`    tokens: in=${result.usage.inputTokens} out=${result.usage.outputTokens} cache_create=${result.usage.cacheCreationTokens} cache_read=${result.usage.cacheReadTokens}`);
  for (const i of result.ideas) console.log(`    - [${i.targetLengthSec}s] ${i.title}`);

  if (result.ideas.length < 1) {
    console.error("FAIL: no ideas returned");
    process.exit(1);
  }
  console.log("OK: phase1-hello passed");
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
