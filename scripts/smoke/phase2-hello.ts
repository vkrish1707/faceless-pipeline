import { config } from "dotenv";
config({ path: ".env.local" });

import { extractIdeas, scoreIdea, suggestForChapter } from "../../packages/pipeline/src";
import { extractKeywords, redditSearch, buildTrendSummary } from "../../packages/trends/src";

const SKIP_TRENDS = process.env.SKIP_TRENDS === "1";

const CHAPTER = `The Power of Compound Interest

Compound interest is the eighth wonder of the world. He who understands it earns it; he who doesn't pays it. A small amount invested early outperforms a large amount invested late because of doubling time. Consider two savers: Anna who invests three hundred dollars a month from age twenty-five to thirty-five and then stops, and Bob who invests three hundred dollars a month from age thirty-five to sixty-five. By age sixty-five Anna ends up with more money than Bob despite contributing for only ten years. The reason is that her early dollars have more years to double. Time, not amount, is the primary lever. Most investors get this exactly backwards.

The doubling rule of seventy-two makes this concrete: at seven percent returns money doubles every ten point three years. At ten percent, every seven point two years. The first double matters less than the last double, because the last double is a much bigger absolute amount. This is why compounding feels slow at first and then accelerates dramatically near retirement.`;

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("FAIL: ANTHROPIC_API_KEY missing");
    process.exit(1);
  }

  console.log("==> extracting ideas (Claude) ...");
  const t0 = Date.now();
  const { ideas, usage: extractUsage } = await extractIdeas({ chapterText: CHAPTER, apiKey });
  console.log(`    ${ideas.length} ideas in ${Date.now() - t0}ms`);
  console.log(`    tokens in/out: ${extractUsage.inputTokens}/${extractUsage.outputTokens}`);
  if (ideas.length < 1) throw new Error("expected at least 1 idea");

  const keywords = extractKeywords(CHAPTER, ideas.map((i) => ({ title: i.title })));
  console.log(`==> extracted ${keywords.length} keywords: ${keywords.slice(0, 5).join(", ")}...`);

  console.log("==> fetching trend signals ...");
  const perKeyword = await Promise.all(
    keywords.slice(0, 4).map(async (kw) => {
      if (SKIP_TRENDS) return { keyword: kw, google: null, reddit: null };
      const reddit = await redditSearch({ keyword: kw, maxAttempts: 1 });
      return { keyword: kw, google: null, reddit };
    })
  );
  const trendSummary = buildTrendSummary(perKeyword);
  console.log(`    summary has ${Object.keys(trendSummary.perKeyword).length} entries`);

  const target = ideas[0]!;
  console.log(`==> scoring idea: "${target.title}" ...`);
  const t1 = Date.now();
  const score = await scoreIdea({
    idea: {
      id: "smoke-1",
      title: target.title,
      summary: target.summary,
      targetLengthSec: target.targetLengthSec,
      candidateHooks: target.candidateHooks,
    },
    chapterText: CHAPTER,
    trendSummaryForIdea: trendSummary,
    apiKey,
  });
  console.log(`    score=${score.score} in ${Date.now() - t1}ms`);
  console.log(`    breakdown: ${JSON.stringify(score.breakdown)}`);
  if (score.score < 0 || score.score > 100) throw new Error("score out of range");

  console.log("==> running suggestion pass ...");
  const t2 = Date.now();
  const ideasForSuggest = ideas.map((i, idx) => ({
    id: `smoke-${idx}`,
    title: i.title,
    summary: i.summary,
    score: idx === 0 ? score.score : null,
    breakdown: idx === 0 ? score.breakdown : null,
  }));
  const sug = await suggestForChapter({
    chapterText: CHAPTER,
    ideas: ideasForSuggest,
    trendSummary,
    apiKey,
  });
  const total =
    sug.merges.length + sug.splits.length + sug.drops.length + sug.series.length + sug.reframes.length;
  console.log(`    ${total} suggestions in ${Date.now() - t2}ms`);
  console.log(
    `    merges=${sug.merges.length} splits=${sug.splits.length} drops=${sug.drops.length} series=${sug.series.length} reframes=${sug.reframes.length}`
  );

  console.log("\n✅ phase2 smoke OK");
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
