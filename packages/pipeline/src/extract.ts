import Anthropic from "@anthropic-ai/sdk";
import { ZodError } from "zod";
import { ExtractResponseSchema, type ExtractedIdea } from "./schemas";
import { SYSTEM_PROMPT, USER_PROMPT } from "./prompts";

export class NonRetryableError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "NonRetryableError";
  }
}

export type ExtractUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
};

export type ExtractResult = {
  ideas: ExtractedIdea[];
  usage: ExtractUsage;
};

export type ExtractOpts = {
  chapterText: string;
  apiKey: string;
  model?: string;
  maxAttempts?: number;
};

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_ATTEMPTS = 3;

function isRetryable(err: unknown): boolean {
  if (err instanceof NonRetryableError) return false;
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: number }).status;
  if (status === undefined) return true; // network/unknown
  return status === 429 || (status >= 500 && status < 600);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function extractIdeas(opts: ExtractOpts): Promise<ExtractResult> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const model = opts.model ?? DEFAULT_MODEL;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await client.messages.create({
        model,
        max_tokens: 2048,
        system: [
          { type: "text", text: SYSTEM_PROMPT },
          { type: "text", text: opts.chapterText, cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: USER_PROMPT }],
      });

      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new NonRetryableError(`Claude returned invalid JSON: ${text.slice(0, 200)}`);
      }

      let validated;
      try {
        validated = ExtractResponseSchema.parse(parsed);
      } catch (e) {
        if (e instanceof ZodError) {
          throw new NonRetryableError(`Claude response failed schema validation: ${e.message}`, e);
        }
        throw e;
      }

      const usage: ExtractUsage = {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheCreationTokens: res.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      };

      return { ideas: validated.ideas, usage };
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts && isRetryable(err)) {
        await sleep(2 ** (attempt - 1) * 500 + Math.random() * 200);
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("extractIdeas: exhausted attempts");
}
