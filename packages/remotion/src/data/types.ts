/**
 * Shared types for the Remotion composition's input contract.
 *
 * `RenderInput` is the exact JSON shape produced by
 * `apps/studio/lib/render/build-input.ts` and consumed by `Video.tsx` via
 * Remotion's `getInputProps()`. Keeping these types here keeps the boundary
 * clean: the studio app imports them through the workspace alias (no Prisma
 * leak) and the composition only imports its own types.
 */

export type ChartSpec = {
  kind: "bar" | "line" | "stat";
  label: string;
  /** Bar/line data: 2–4 numeric points. */
  data?: number[];
  /** Stat variant: large headline number (string so units like "8%" work). */
  bigNumber?: string;
};

export type Beat = {
  /** Inclusive start, in seconds (relative to audio t=0). */
  start: number;
  /** Exclusive end, in seconds. */
  end: number;
  tone: "urgent" | "explainer" | "payoff";
  /** Absolute path resolved by `buildRenderInput`. */
  assetPath: string;
  assetType: "photo" | "video";
  chart?: ChartSpec;
};

export type CaptionWord = {
  word: string;
  start: number;
  end: number;
};

export type Theme = "finance-dark" | "finance-light";

export type Metadata = {
  youtubeTitle: string;
  caption: string;
  hashtags: string[];
  thumbnailConcept: string;
};

export type RenderInput = {
  scriptId: string;
  durationFrames: number;
  fps: 30;
  width: 1080;
  height: 1920;
  audioPath: string;
  captions: { words: CaptionWord[] };
  visualBeats: Beat[];
  theme: Theme;
  metadata: Metadata;
  /** Optional hook text for the overlay scene (first 3s). */
  hookText?: string;
  /** Optional CTA text for the overlay scene (last 2s). */
  ctaText?: string;
};
