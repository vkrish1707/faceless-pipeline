import Anthropic from "@anthropic-ai/sdk";
import { ZodError } from "zod";
import { NonRetryableError } from "./extract";
import { SuggestResponseSchema, type SuggestResponse, type Breakdown } from "./schemas";
import { SUGGESTION_SYSTEM_PROMPT } from "./prompts";

export type SuggestUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
};

export type SuggestIdeaInput = {
  id: string;
  title: string;
  summary: string;
  score: number | null;
  breakdown: Breakdown | null;
};

export type SuggestOpts = {
  chapterText: string;
  ideas: SuggestIdeaInput[];
  trendSummary: unknown;
  apiKey: string;
  model?: string;
  maxAttempts?: number;
};

export type SuggestReturn = SuggestResponse & { usage: SuggestUsage };

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_ATTEMPTS = 3;

function isRetryable(err: unknown): boolean {
  if (err instanceof NonRetryableError) return false;
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: number }).status;
  if (status === undefined) return true;
  return status === 429 || (status >= 500 && status < 600);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function userPrompt(ideas: SuggestIdeaInput[], trendSummary: unknown, correction?: string): string {
  const lines = [
    `Review the following ideas extracted from this chapter and propose merges, splits, drops, series, and reframes.`,
    `Only suggest changes when confidence is high. Empty arrays are valid.`,
    ``,
    `IDEAS:`,
    JSON.stringify(ideas, null, 2),
    ``,
    `CHAPTER TREND SIGNAL:`,
    JSON.stringify(trendSummary ?? {}, null, 2),
    ``,
    `Reply with JSON only.`,
  ];
  if (correction) lines.push(``, `CORRECTION REQUIRED: ${correction}`);
  return lines.join("\n");
}

export async function suggestForChapter(opts: SuggestOpts): Promise<SuggestReturn> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const model = opts.model ?? DEFAULT_MODEL;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const validIds = new Set(opts.ideas.map((i) => i.id));

  let correction: string | undefined;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await client.messages.create({
        model,
        max_tokens: 2048,
        system: [
          { type: "text", text: SUGGESTION_SYSTEM_PROMPT },
          { type: "text", text: opts.chapterText, cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: userPrompt(opts.ideas, opts.trendSummary, correction) }],
      });

      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      const stripped = text.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/s, "$1").trim();

      let parsed: unknown;
      try {
        parsed = JSON.parse(stripped);
      } catch {
        if (!correction && attempt < maxAttempts) {
          correction = `Your previous output was not valid JSON. Reply with JSON only.`;
          continue;
        }
        throw new NonRetryableError(`Claude suggest returned invalid JSON: ${text.slice(0, 200)}`);
      }

      let validated: SuggestResponse;
      try {
        validated = SuggestResponseSchema.parse(parsed);
      } catch (e) {
        if (e instanceof ZodError) {
          if (!correction && attempt < maxAttempts) {
            correction = `Your previous output failed schema validation: ${e.message.slice(0, 300)}. Reply with JSON only.`;
            continue;
          }
          throw new NonRetryableError(`Claude suggest schema failed: ${e.message}`, e);
        }
        throw e;
      }

      const filtered = filterToKnownIds(validated, validIds);
      const usage: SuggestUsage = {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheCreationTokens: res.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      };
      return { ...filtered, usage };
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts && isRetryable(err)) {
        await sleep(2 ** (attempt - 1) * 500 + Math.random() * 200);
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("suggestForChapter: exhausted attempts");
}

function filterToKnownIds(s: SuggestResponse, valid: Set<string>): SuggestResponse {
  return {
    merges: s.merges.filter((m) => m.ideaIds.every((id) => valid.has(id))),
    splits: s.splits.filter((sp) => valid.has(sp.ideaId)),
    drops: s.drops.filter((d) => valid.has(d.ideaId)),
    series: s.series.filter((se) => se.ideaIds.every((id) => valid.has(id))),
    reframes: s.reframes.filter((r) => valid.has(r.ideaId)),
  };
}
