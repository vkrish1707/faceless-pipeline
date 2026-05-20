import { config } from "dotenv";
config({ path: ".env.local" });
import Anthropic from "@anthropic-ai/sdk";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("FAIL: ANTHROPIC_API_KEY missing in .env.local");
  process.exit(1);
}

const client = new Anthropic({ apiKey });

async function main() {
  const t0 = Date.now();
  const res = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 64,
    messages: [{ role: "user", content: "Reply with exactly: PIPELINE OK" }],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const dt = Date.now() - t0;
  console.log(`response: ${text.trim()}`);
  console.log(`latency:  ${dt}ms`);
  console.log(`tokens:   in=${res.usage.input_tokens} out=${res.usage.output_tokens}`);
  if (!text.includes("PIPELINE OK")) {
    console.error("FAIL: did not get expected response");
    process.exit(1);
  }
  console.log("OK: claude-hello passed");
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
