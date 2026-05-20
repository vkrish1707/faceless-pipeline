import pLimit from "p-limit";
import {
  scoreIdea as defaultScoreIdea,
  suggestForChapter as defaultSuggestForChapter,
  type ScoreReturn,
  type SuggestReturn,
} from "@studio/pipeline";
import {
  extractKeywords as defaultExtractKeywords,
  googleTrends as defaultGoogleTrends,
  redditSearch as defaultRedditSearch,
  cachedTrendRead as defaultCachedTrendRead,
  buildTrendSummary,
  type GoogleTrendsData,
  type RedditTrendsData,
  type TrendSummary,
} from "@studio/trends";
import { db as defaultDb } from "../../db";
import type { JobHandler } from "../types";

export type ScoreChapterPayload = { chapterId: string };
export type ScoreChapterResult = {
  scored: number;
  suggestionsCreated: number;
  trendsCacheHits: number;
  trendsCacheMisses: number;
};

type Deps = {
  db?: typeof defaultDb;
  extractKeywords?: typeof defaultExtractKeywords;
  googleTrends?: typeof defaultGoogleTrends;
  redditSearch?: typeof defaultRedditSearch;
  cachedTrendRead?: typeof defaultCachedTrendRead;
  scoreIdea?: typeof defaultScoreIdea;
  suggestForChapter?: typeof defaultSuggestForChapter;
  scoreConcurrency?: number;
  trendConcurrency?: { google: number; reddit: number };
};

export function createScoreChapterHandler(deps: Deps = {}): JobHandler<ScoreChapterPayload, ScoreChapterResult> {
  const db = deps.db ?? defaultDb;
  const extractKeywords = deps.extractKeywords ?? defaultExtractKeywords;
  const googleTrendsFn = deps.googleTrends ?? defaultGoogleTrends;
  const redditSearchFn = deps.redditSearch ?? defaultRedditSearch;
  const cachedTrendReadFn = deps.cachedTrendRead ?? defaultCachedTrendRead;
  const scoreIdeaFn = deps.scoreIdea ?? defaultScoreIdea;
  const suggestForChapterFn = deps.suggestForChapter ?? defaultSuggestForChapter;
  const scoreConcurrency = deps.scoreConcurrency ?? 5;
  const trendConcurrency = deps.trendConcurrency ?? { google: 3, reddit: 5 };

  return async function handleScoreChapter(payload, ctx) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

    const chapter = await db.chapter.findUniqueOrThrow({
      where: { id: payload.chapterId },
      include: { ideas: true },
    });
    if (chapter.ideas.length === 0) {
      throw new Error(`chapter ${payload.chapterId} has no ideas to score`);
    }

    // Stage 1: fetch trends (0 → 10)
    await ctx.updateProgress(2);
    const keywords = extractKeywords(
      chapter.rawText,
      chapter.ideas.map((i) => ({ title: i.title }))
    );

    let hits = 0;
    let misses = 0;
    const googleLimit = pLimit(trendConcurrency.google);
    const redditLimit = pLimit(trendConcurrency.reddit);

    const googleResults = await Promise.all(
      keywords.map((kw) =>
        googleLimit(async () => {
          const out = await cachedTrendReadFn<GoogleTrendsData>({
            db,
            keyword: kw,
            source: "google",
            fetcher: () => googleTrendsFn({ keyword: kw }),
          });
          if (out.hit) hits += 1;
          else misses += 1;
          return { keyword: kw, data: out.data };
        })
      )
    );

    const redditResults = await Promise.all(
      keywords.map((kw) =>
        redditLimit(async () => {
          const out = await cachedTrendReadFn<RedditTrendsData>({
            db,
            keyword: kw,
            source: "reddit",
            fetcher: () => redditSearchFn({ keyword: kw }),
          });
          if (out.hit) hits += 1;
          else misses += 1;
          return { keyword: kw, data: out.data };
        })
      )
    );

    const perKeywordResults = keywords.map((kw) => ({
      keyword: kw,
      google: googleResults.find((g) => g.keyword === kw)?.data ?? null,
      reddit: redditResults.find((r) => r.keyword === kw)?.data ?? null,
    }));
    const trendSummary: TrendSummary = buildTrendSummary(perKeywordResults);

    await ctx.updateProgress(10);

    // Stage 2: score each idea (10 → 60)
    const scoreLimit = pLimit(scoreConcurrency);
    const span = 50;
    let scoredCount = 0;
    let scoreUsageIn = 0;
    let scoreUsageOut = 0;
    let scoreCacheRead = 0;
    let scoreCacheCreated = 0;
    const errors: { ideaId: string; error: string }[] = [];

    await Promise.all(
      chapter.ideas.map((idea) =>
        scoreLimit(async () => {
          try {
            const ideaKeywords = pickIdeaKeywords(idea.title, keywords);
            const ideaTrendSummary = {
              perKeyword: Object.fromEntries(
                ideaKeywords.map((kw) => [kw, trendSummary.perKeyword[kw] ?? null]).filter(([, v]) => v !== null)
              ),
            };
            const partialErr = perKeywordResults.some(
              (r) =>
                ideaKeywords.includes(r.keyword) && (r.google === null || r.reddit === null)
            );

            const result: ScoreReturn = await scoreIdeaFn({
              idea: {
                id: idea.id,
                title: idea.title,
                summary: idea.summary,
                targetLengthSec: idea.targetLengthSec,
                candidateHooks: (idea.candidateHooks as string[] | null) ?? [],
              },
              chapterText: chapter.rawText,
              trendSummaryForIdea: ideaTrendSummary,
              apiKey,
            });

            await db.idea.update({
              where: { id: idea.id },
              data: {
                score: result.score,
                scoreBreakdown: result.breakdown,
                flags: result.flags,
                trendSignals: { ...ideaTrendSummary, error: partialErr ? "partial" : null },
              },
            });

            scoreUsageIn += result.usage.inputTokens;
            scoreUsageOut += result.usage.outputTokens;
            scoreCacheRead += result.usage.cacheReadTokens;
            scoreCacheCreated += result.usage.cacheCreationTokens;
            scoredCount += 1;
            await ctx.updateProgress(
              10 + Math.floor((scoredCount / chapter.ideas.length) * span)
            );
          } catch (err) {
            errors.push({
              ideaId: idea.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })
      )
    );

    await ctx.updateProgress(60);

    // Stage 3: suggest (60 → 95)
    const refreshedIdeas = await db.idea.findMany({ where: { chapterId: payload.chapterId } });
    const suggestInput = refreshedIdeas.map((i) => ({
      id: i.id,
      title: i.title,
      summary: i.summary,
      score: i.score ?? null,
      breakdown: (i.scoreBreakdown as never) ?? null,
    }));

    let suggestionsCreated = 0;
    let suggestUsage: SuggestReturn["usage"] | null = null;
    try {
      const result = await suggestForChapterFn({
        chapterText: chapter.rawText,
        ideas: suggestInput,
        trendSummary,
        apiKey,
      });
      suggestUsage = result.usage;

      const rows: Array<{ kind: string; payload: unknown; reason: string }> = [];
      for (const m of result.merges)
        rows.push({ kind: "merge", payload: { ideaIds: m.ideaIds, combinedTitle: m.combinedTitle }, reason: m.reason });
      for (const s of result.splits)
        rows.push({ kind: "split", payload: { ideaId: s.ideaId, parts: s.parts }, reason: s.reason });
      for (const d of result.drops)
        rows.push({ kind: "drop", payload: { ideaId: d.ideaId }, reason: d.reason });
      for (const se of result.series)
        rows.push({ kind: "series", payload: { ideaIds: se.ideaIds, seriesTitle: se.seriesTitle }, reason: se.reason });
      for (const r of result.reframes)
        rows.push({ kind: "reframe", payload: { ideaId: r.ideaId, altHooks: r.altHooks }, reason: r.reason });

      if (rows.length > 0) {
        await db.suggestion.createMany({
          data: rows.map((r) => ({
            chapterId: payload.chapterId,
            kind: r.kind,
            payload: r.payload as never,
            reason: r.reason,
            status: "open",
          })),
        });
        suggestionsCreated = rows.length;
      }
    } catch (err) {
      errors.push({
        ideaId: "(suggest)",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await ctx.updateProgress(95);

    // Stage 4: persist usage + finish (95 → 100)
    await db.apiUsage.create({
      data: {
        service: "anthropic",
        endpoint: "messages.create:score+suggest",
        tokensIn: scoreUsageIn + (suggestUsage?.inputTokens ?? 0),
        tokensOut: scoreUsageOut + (suggestUsage?.outputTokens ?? 0),
        cacheTokensRead: scoreCacheRead + (suggestUsage?.cacheReadTokens ?? 0),
        cacheTokensCreated: scoreCacheCreated + (suggestUsage?.cacheCreationTokens ?? 0),
        traceId: ctx.jobId,
      },
    });

    await ctx.updateProgress(100);

    return {
      scored: scoredCount,
      suggestionsCreated,
      trendsCacheHits: hits,
      trendsCacheMisses: misses,
      ...(errors.length > 0 ? { errors } : {}),
    };
  };
}

function pickIdeaKeywords(ideaTitle: string, all: string[]): string[] {
  const lower = ideaTitle.toLowerCase();
  const matches = all.filter((kw) => lower.includes(kw));
  if (matches.length > 0) return matches.slice(0, 4);
  return all.slice(0, 4);
}

export const handleScoreChapter = createScoreChapterHandler();
