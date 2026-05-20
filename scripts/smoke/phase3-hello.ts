import { config } from "dotenv";
config({ path: ".env.local" });

import { generateScript, rescoreScript } from "../../packages/pipeline/src";

const CHAPTER = `Compound interest is the eighth wonder of the world. A small amount invested early outperforms a large amount invested late because of doubling time. Anna invests three hundred dollars a month from age twenty-five to thirty-five and stops. Bob invests three hundred dollars a month from age thirty-five to sixty-five. By age sixty-five Anna ends up with more money than Bob despite contributing for only ten years.`;

const IDEA = {
  title: "Compound interest is unforgivingly fast",
  summary: "Small early contributions outperform large late ones because of doubling time.",
  targetLengthSec: 30 as const,
  sourceQuotes: ["compound interest is the eighth wonder of the world"],
  candidateHooks: [
    "One dollar at twenty-five beats ten at forty-five.",
    "Your future self begs you to start now.",
  ],
};

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("FAIL: ANTHROPIC_API_KEY missing");
    process.exit(1);
  }

  console.log("==> generating script (Claude) ...");
  const t0 = Date.now();
  const { script, usage } = await generateScript({
    idea: IDEA,
    chapterText: CHAPTER,
    niche: "investing",
    apiKey,
  });
  console.log(`    ${Date.now() - t0}ms; hook: "${script.hook}"`);
  console.log(`    body words: ${script.body.split(/\s+/).length}`);
  console.log(`    beats: ${script.visualBeats.length}`);
  console.log(`    hashtags: ${script.metadata.hashtags.join(" ")}`);
  console.log(`    tokens in/out: ${usage.inputTokens}/${usage.outputTokens}`);

  if (script.visualBeats.length < 2) throw new Error("expected at least 2 beats");
  if (!script.metadata.youtubeTitle) throw new Error("metadata missing youtubeTitle");

  console.log("==> re-scoring script (Claude) ...");
  const t1 = Date.now();
  const rs = await rescoreScript({
    script: {
      title: IDEA.title,
      hook: script.hook,
      body: script.body,
      cta: script.cta,
      targetLengthSec: IDEA.targetLengthSec,
    },
    chapterText: CHAPTER,
    trendSummary: {},
    apiKey,
  });
  console.log(`    score=${rs.score} in ${Date.now() - t1}ms`);
  console.log(`    cache reads: ${rs.usage.cacheReadTokens}`);

  console.log("\n✅ phase3 smoke OK");
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
