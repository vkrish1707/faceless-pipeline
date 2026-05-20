import { rescoreScript as defaultRescoreScript } from "@studio/pipeline";
import { db as defaultDb } from "../../db";
import type { JobHandler } from "../types";

export type RescoreScriptPayload = { scriptId: string };
export type RescoreScriptResult = { scriptId: string; score: number };

type Deps = {
  db?: typeof defaultDb;
  rescoreScript?: typeof defaultRescoreScript;
};

export function createRescoreScriptHandler(deps: Deps = {}): JobHandler<RescoreScriptPayload, RescoreScriptResult> {
  const db = deps.db ?? defaultDb;
  const rescoreScriptFn = deps.rescoreScript ?? defaultRescoreScript;

  return async function handleRescoreScript(payload, ctx) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

    const script = await db.script.findUniqueOrThrow({
      where: { id: payload.scriptId },
      include: { idea: { include: { chapter: true } } },
    });

    await ctx.updateProgress(30);

    const trendSummary = script.idea.trendSignals ?? {};
    const result = await rescoreScriptFn({
      script: {
        title: script.idea.title,
        hook: script.hook,
        body: script.body,
        cta: script.cta,
        targetLengthSec: script.idea.targetLengthSec,
      },
      chapterText: script.idea.chapter.rawText,
      trendSummary,
      apiKey,
    });

    await ctx.updateProgress(85);

    await db.$transaction(async (tx) => {
      await tx.script.update({
        where: { id: script.id },
        data: { score: result.score, scoreBreakdown: result.breakdown as never },
      });
      await tx.apiUsage.create({
        data: {
          service: "anthropic",
          endpoint: "messages.create:rescore_script",
          tokensIn: result.usage.inputTokens,
          tokensOut: result.usage.outputTokens,
          cacheTokensRead: result.usage.cacheReadTokens,
          cacheTokensCreated: result.usage.cacheCreationTokens,
          traceId: ctx.jobId,
        },
      });
    });

    await ctx.updateProgress(100);
    return { scriptId: script.id, score: result.score };
  };
}

export const handleRescoreScript = createRescoreScriptHandler();
