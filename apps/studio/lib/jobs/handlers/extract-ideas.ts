import { extractIdeas } from "@studio/pipeline";
import { db } from "../../db";
import type { JobHandler } from "../types";

export type ExtractIdeasPayload = { chapterId: string };
export type ExtractIdeasResult = { ideasCreated: number };

export const handleExtractIdeas: JobHandler<ExtractIdeasPayload, ExtractIdeasResult> = async (
  payload,
  ctx
) => {
  const chapter = await db.chapter.findUniqueOrThrow({ where: { id: payload.chapterId } });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  await ctx.updateProgress(20);

  const { ideas, usage } = await extractIdeas({
    chapterText: chapter.rawText,
    apiKey,
  });

  await ctx.updateProgress(80);

  await db.$transaction(async (tx) => {
    await tx.idea.deleteMany({ where: { chapterId: payload.chapterId } });
    for (const i of ideas) {
      await tx.idea.create({
        data: {
          chapterId: payload.chapterId,
          title: i.title,
          summary: i.summary,
          targetLengthSec: i.targetLengthSec,
          sourceQuotes: i.sourceQuotes,
          candidateHooks: i.candidateHooks,
          status: "draft",
        },
      });
    }
    await tx.chapter.update({ where: { id: payload.chapterId }, data: { status: "extracted" } });
    await tx.apiUsage.create({
      data: {
        service: "anthropic",
        endpoint: "messages.create",
        tokensIn: usage.inputTokens,
        tokensOut: usage.outputTokens,
        cacheTokensRead: usage.cacheReadTokens,
        cacheTokensCreated: usage.cacheCreationTokens,
        traceId: ctx.jobId,
      },
    });
  });

  return { ideasCreated: ideas.length };
};
