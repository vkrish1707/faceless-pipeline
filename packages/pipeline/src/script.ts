import Anthropic from "@anthropic-ai/sdk";
import { ZodError } from "zod";
import { NonRetryableError } from "./extract";
import { ScriptSchema, type ScriptOutput, type Breakdown } from "./schemas";
import { SCRIPT_SYSTEM_PROMPT, styleGuideFor } from "./prompts";

export type ScriptUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
};

export type ScriptIdeaInput = {
  title: string;
  summary: string;
  targetLengthSec: number;
  sourceQuotes: string[];
  candidateHooks: string[];
  altHooks?: string[];
  scoreBreakdown?: Breakdown | null;
};

export type GenerateScriptOpts = {
  idea: ScriptIdeaInput;
  chapterText: string;
  niche: string | null | undefined;
  apiKey: string;
  model?: string;
  maxAttempts?: number;
};

export type GenerateScriptReturn = { script: ScriptOutput; usage: ScriptUsage };

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

export function scriptUserPrompt(idea: ScriptIdeaInput, correction?: string): string {
  const hooks = idea.altHooks?.length ? idea.altHooks : idea.candidateHooks;
  const lines = [
    `Write the script for this idea.`,
    ``,
    `IDEA:`,
    JSON.stringify(
      {
        title: idea.title,
        summary: idea.summary,
        targetLengthSec: idea.targetLengthSec,
        sourceQuotes: idea.sourceQuotes,
        suggestedHooks: hooks,
        scoreBreakdown: idea.scoreBreakdown ?? null,
      },
      null,
      2
    ),
    ``,
    `Constraints:`,
    `- visualBeats MUST cover 0 to ${idea.targetLengthSec}s with no overlap.`,
    `- Word count of hook + body + cta should target ~${Math.round(idea.targetLengthSec * 2.5)} words.`,
    `- Hashtags lowercase, no spaces, alphanumeric/underscore only, prefixed with #.`,
    ``,
    `Reply with JSON only.`,
  ];
  if (correction) lines.push(``, `CORRECTION REQUIRED: ${correction}`);
  return lines.join("\n");
}

function beatsOverlap(beats: ScriptOutput["visualBeats"]): boolean {
  const sorted = [...beats].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.start < sorted[i - 1]!.end) return true;
  }
  return false;
}

export async function generateScript(opts: GenerateScriptOpts): Promise<GenerateScriptReturn> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const model = opts.model ?? DEFAULT_MODEL;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  let correction: string | undefined;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await client.messages.create({
        model,
        max_tokens: 2048,
        system: [
          { type: "text", text: SCRIPT_SYSTEM_PROMPT },
          { type: "text", text: opts.chapterText, cache_control: { type: "ephemeral" } },
          { type: "text", text: styleGuideFor(opts.niche), cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: scriptUserPrompt(opts.idea, correction) }],
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
        throw new NonRetryableError(`Claude script returned invalid JSON: ${text.slice(0, 200)}`);
      }

      let validated: ScriptOutput;
      try {
        validated = ScriptSchema.parse(parsed);
      } catch (e) {
        if (e instanceof ZodError) {
          if (!correction && attempt < maxAttempts) {
            correction = `Your previous output failed schema validation: ${e.message.slice(0, 300)}. Reply with JSON only.`;
            continue;
          }
          throw new NonRetryableError(`Claude script schema failed: ${e.message}`, e);
        }
        throw e;
      }

      if (beatsOverlap(validated.visualBeats)) {
        if (!correction && attempt < maxAttempts) {
          correction = `Your previous visualBeats overlap. Adjust start/end so no two beats overlap; every second covered exactly once. Reply with JSON only.`;
          continue;
        }
        throw new NonRetryableError(`Claude script visualBeats overlap`);
      }

      // Dedupe hashtags case-insensitively, preserve order.
      const seen = new Set<string>();
      validated.metadata.hashtags = validated.metadata.hashtags.filter((h) => {
        const k = h.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      const usage: ScriptUsage = {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheCreationTokens: res.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      };
      return { script: validated, usage };
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts && isRetryable(err)) {
        await sleep(2 ** (attempt - 1) * 500 + Math.random() * 200);
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("generateScript: exhausted attempts");
}
