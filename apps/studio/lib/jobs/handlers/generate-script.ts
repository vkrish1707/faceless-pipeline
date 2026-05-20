import { generateScript as defaultGenerateScript } from "@studio/pipeline";
import { db as defaultDb } from "../../db";
import { buildWarnings } from "../../scripts/validators";
import type { JobHandler } from "../types";

export type GenerateScriptPayload = { ideaId: string; groupId?: string };
export type GenerateScriptResult = { scriptId: string; warnings: number };

type Deps = {
  db?: typeof defaultDb;
  generateScript?: typeof defaultGenerateScript;
};

export function createGenerateScriptHandler(deps: Deps = {}): JobHandler<GenerateScriptPayload, GenerateScriptResult> {
  const db = deps.db ?? defaultDb;
  const generateScriptFn = deps.generateScript ?? defaultGenerateScript;

  return async function handleGenerateScript(payload, ctx) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

    const idea = await db.idea.findUniqueOrThrow({
      where: { id: payload.ideaId },
      include: { chapter: { include: { book: true } } },
    });

    await ctx.updateProgress(30);

    const altHooks = (() => {
      const flags = idea.flags as { altHooks?: unknown } | null;
      if (flags && Array.isArray(flags.altHooks)) {
        return flags.altHooks.filter((x): x is string => typeof x === "string");
      }
      return undefined;
    })();

    const { script, usage } = await generateScriptFn({
      idea: {
        title: idea.title,
        summary: idea.summary,
        targetLengthSec: idea.targetLengthSec,
        sourceQuotes: (idea.sourceQuotes as string[] | null) ?? [],
        candidateHooks: (idea.candidateHooks as string[] | null) ?? [],
        altHooks,
        scoreBreakdown: (idea.scoreBreakdown as never) ?? null,
      },
      chapterText: idea.chapter.rawText,
      niche: idea.chapter.book.niche,
      apiKey,
    });

    await ctx.updateProgress(85);

    const warnings = buildWarnings({
      hook: script.hook,
      body: script.body,
      cta: script.cta,
      beats: script.visualBeats,
      targetLengthSec: idea.targetLengthSec,
    });

    const now = new Date();
    const persisted = await db.$transaction(async (tx) => {
      const existing = await tx.script.findUnique({ where: { ideaId: idea.id } });
      const data = {
        hook: script.hook,
        body: script.body,
        cta: script.cta,
        visualBeats: script.visualBeats as never,
        metadata: script.metadata as never,
        warnings: (warnings.length > 0 ? warnings : null) as never,
        status: "draft",
        generatedAt: now,
        lastEditedAt: null,
      };
      const row = existing
        ? await tx.script.update({ where: { ideaId: idea.id }, data })
        : await tx.script.create({ data: { ...data, ideaId: idea.id } });

      await tx.idea.update({ where: { id: idea.id }, data: { status: "scripted" } });

      await tx.apiUsage.create({
        data: {
          service: "anthropic",
          endpoint: "messages.create:generate_script",
          tokensIn: usage.inputTokens,
          tokensOut: usage.outputTokens,
          cacheTokensRead: usage.cacheReadTokens,
          cacheTokensCreated: usage.cacheCreationTokens,
          traceId: ctx.jobId,
        },
      });

      return row;
    });

    await ctx.updateProgress(100);
    return { scriptId: persisted.id, warnings: warnings.length };
  };
}

export const handleGenerateScript = createGenerateScriptHandler();
