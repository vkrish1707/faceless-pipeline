import { z } from "zod";

export const IdeaSchema = z.object({
  title: z.string().min(3).max(120),
  summary: z.string().min(10).max(400),
  targetLengthSec: z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(90)]),
  sourceQuotes: z.array(z.string()).min(1).max(5),
  candidateHooks: z.array(z.string()).min(2).max(3),
});

export const ExtractResponseSchema = z.object({
  ideas: z.array(IdeaSchema).min(1).max(8),
});

export type ExtractedIdea = z.infer<typeof IdeaSchema>;
export type ExtractResponse = z.infer<typeof ExtractResponseSchema>;

export const BreakdownSchema = z.object({
  hook_strength: z.number().int().min(0).max(25),
  specificity: z.number().int().min(0).max(20),
  trend_alignment: z.number().int().min(0).max(25),
  format_fit: z.number().int().min(0).max(15),
  shelf_life: z.number().int().min(0).max(15),
});

export const ScoreSchema = z.object({
  score: z.number().int().min(0).max(100),
  breakdown: BreakdownSchema,
  reasoning: z.string().min(10).max(400),
  flags: z.array(z.string()).max(5),
});

export type Breakdown = z.infer<typeof BreakdownSchema>;
export type ScoreResult = z.infer<typeof ScoreSchema>;

const MergeSchema = z.object({
  ideaIds: z.array(z.string()).min(2),
  combinedTitle: z.string().min(3).max(120),
  reason: z.string().min(5).max(300),
});

const SplitSchema = z.object({
  ideaId: z.string(),
  parts: z
    .array(z.object({ title: z.string().min(3).max(120), summary: z.string().min(10).max(400) }))
    .min(2)
    .max(4),
  reason: z.string().min(5).max(300),
});

const DropSchema = z.object({
  ideaId: z.string(),
  reason: z.string().min(5).max(300),
});

const SeriesSchema = z.object({
  ideaIds: z.array(z.string()).min(2),
  seriesTitle: z.string().min(3).max(120),
  reason: z.string().min(5).max(300),
});

const ReframeSchema = z.object({
  ideaId: z.string(),
  altHooks: z.array(z.string().min(3).max(160)).min(1).max(4),
  reason: z.string().min(5).max(300),
});

export const SuggestResponseSchema = z.object({
  merges: z.array(MergeSchema).default([]),
  splits: z.array(SplitSchema).default([]),
  drops: z.array(DropSchema).default([]),
  series: z.array(SeriesSchema).default([]),
  reframes: z.array(ReframeSchema).default([]),
});

export type SuggestResponse = z.infer<typeof SuggestResponseSchema>;
export type MergeSuggestion = z.infer<typeof MergeSchema>;
export type SplitSuggestion = z.infer<typeof SplitSchema>;
export type DropSuggestion = z.infer<typeof DropSchema>;
export type SeriesSuggestion = z.infer<typeof SeriesSchema>;
export type ReframeSuggestion = z.infer<typeof ReframeSchema>;
