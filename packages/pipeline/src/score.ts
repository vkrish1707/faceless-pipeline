import Anthropic from "@anthropic-ai/sdk";
import { ZodError } from "zod";
import { NonRetryableError } from "./extract";
import { ScoreSchema, type ScoreResult } from "./schemas";
import { SCORING_SYSTEM_PROMPT } from "./prompts";

export type ScoreUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
};

export type ScoreIdeaInput = {
  id: string;
  title: string;
  summary: string;
  targetLengthSec: number;
  candidateHooks: string[];
};

export type ScoreOpts = {
  idea: ScoreIdeaInput;
  chapterText: string;
  trendSummaryForIdea: unknown;
  apiKey: string;
  model?: string;
  maxAttempts?: number;
};

export type ScoreReturn = ScoreResult & { usage: ScoreUsage };

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

export function scoreUserPrompt(idea: ScoreIdeaInput, trendSummary: unknown, correction?: string): string {
  const lines = [
    `Score the following video idea.`,
    ``,
    `IDEA:`,
    JSON.stringify(
      {
        title: idea.title,
        summary: idea.summary,
        targetLengthSec: idea.targetLengthSec,
        candidateHooks: idea.candidateHooks,
      },
      null,
      2
    ),
    ``,
    `TREND SIGNAL (subset for this idea's keywords):`,
    JSON.stringify(trendSummary ?? {}, null, 2),
    ``,
    `Reply with JSON only.`,
  ];
  if (correction) {
    lines.push(``, `CORRECTION REQUIRED: ${correction}`);
  }
  return lines.join("\n");
}

export async function scoreIdea(opts: ScoreOpts): Promise<ScoreReturn> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const model = opts.model ?? DEFAULT_MODEL;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  let correction: string | undefined;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await client.messages.create({
        model,
        max_tokens: 1024,
        system: [
          { type: "text", text: SCORING_SYSTEM_PROMPT },
          { type: "text", text: opts.chapterText, cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: scoreUserPrompt(opts.idea, opts.trendSummaryForIdea, correction) }],
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
        throw new NonRetryableError(`Claude score returned invalid JSON: ${text.slice(0, 200)}`);
      }

      let validated: ScoreResult;
      try {
        validated = ScoreSchema.parse(parsed);
      } catch (e) {
        if (e instanceof ZodError) {
          if (!correction && attempt < maxAttempts) {
            correction = `Your previous output failed schema validation: ${e.message.slice(0, 300)}. Reply with JSON only.`;
            continue;
          }
          throw new NonRetryableError(`Claude score schema failed: ${e.message}`, e);
        }
        throw e;
      }

      const sum =
        validated.breakdown.hook_strength +
        validated.breakdown.specificity +
        validated.breakdown.trend_alignment +
        validated.breakdown.format_fit +
        validated.breakdown.shelf_life;
      if (Math.abs(validated.score - sum) > 1) {
        if (!correction && attempt < maxAttempts) {
          correction = `Your score (${validated.score}) did not equal the sum of breakdown (${sum}). Fix it and reply with JSON only.`;
          continue;
        }
        throw new NonRetryableError(`Claude score sum mismatch: score=${validated.score} sum=${sum}`);
      }

      const usage: ScoreUsage = {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheCreationTokens: res.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      };
      return { ...validated, usage };
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts && isRetryable(err)) {
        await sleep(2 ** (attempt - 1) * 500 + Math.random() * 200);
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("scoreIdea: exhausted attempts");
}
