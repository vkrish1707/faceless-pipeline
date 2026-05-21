import path from "node:path";

/**
 * Maps script tones to the background-music track that best matches.
 *
 * The five tones come from the Phase 3 visual-beats schema. Any tone
 * outside this set falls into the `neutral` bucket. Track filenames are
 * stable so the orchestrator can probe for them before invoking ffmpeg.
 */
export const TONE_TO_TRACK: Record<string, string> = {
  urgent: "urgent_pulse.mp3",
  explainer: "calm_focus.mp3",
  payoff: "motivational_lift.mp3",
  cinematic: "cinematic_swell.mp3",
  neutral: "neutral_groove.mp3",
};

export const DEFAULT_TRACK = "neutral_groove.mp3";
export const DEFAULT_TRACK_ROOT = path.resolve("assets/music");

export interface BeatLike {
  tone?: string;
}

export interface PickedTrack {
  tone: string;
  trackFile: string;
  path: string;
}

/**
 * Picks the most-frequent tone in `beats` and returns its track. Ties are
 * broken by the canonical order (urgent > explainer > payoff > cinematic >
 * neutral) so two runs over the same input return the same pick.
 *
 * If `beats` is empty or no tone matches the table, returns
 * `neutral_groove.mp3`.
 */
export function pickTrack(
  beats: ReadonlyArray<BeatLike>,
  opts: { trackRoot?: string } = {}
): PickedTrack {
  const trackRoot = opts.trackRoot ?? DEFAULT_TRACK_ROOT;
  const counts = new Map<string, number>();
  for (const b of beats) {
    if (!b?.tone) continue;
    if (!Object.prototype.hasOwnProperty.call(TONE_TO_TRACK, b.tone)) continue;
    counts.set(b.tone, (counts.get(b.tone) ?? 0) + 1);
  }
  // Canonical tie-break order — keep this stable.
  const order = ["urgent", "explainer", "payoff", "cinematic", "neutral"];
  let bestTone: string | null = null;
  let bestCount = 0;
  for (const tone of order) {
    const c = counts.get(tone) ?? 0;
    if (c > bestCount) {
      bestCount = c;
      bestTone = tone;
    }
  }
  const tone = bestTone ?? "neutral";
  const trackFile = TONE_TO_TRACK[tone] ?? DEFAULT_TRACK;
  return {
    tone,
    trackFile,
    path: path.join(trackRoot, trackFile),
  };
}
