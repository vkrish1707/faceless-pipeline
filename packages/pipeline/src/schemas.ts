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
