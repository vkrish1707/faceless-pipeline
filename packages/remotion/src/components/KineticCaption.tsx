import React from "react";
import { interpolate } from "remotion";
import type { CaptionWord } from "../data/types";
import type { ThemeTokens } from "../theme/tokens";

/**
 * Word-by-word caption overlay. At any frame, exactly one word ("current") is
 * highlighted: it gets `theme.textHighlight` color plus a 1.0→1.1→1.0 scale
 * pulse over a 4-frame window centered on its start frame. Surrounding words
 * are visible but in `textPrimary`.
 *
 * Pure-render — no clock state, no side effects. The current word is computed
 * from the `frame` prop, which `Video.tsx` passes from `useCurrentFrame()`.
 * Splitting it that way lets tests mount this component with a fixed frame
 * (no Remotion runtime needed).
 *
 * We render a small window of words around the current one so very long
 * sentences stay legible without overflowing the 1080×1920 frame.
 */
export type KineticCaptionProps = {
  captions: { words: CaptionWord[] };
  frame: number;
  fps: number;
  theme: ThemeTokens;
  /** How many words to show before/after the current one. Default 2. */
  windowRadius?: number;
};

const PULSE_WINDOW_FRAMES = 4;

export function findCurrentWordIndex(
  words: CaptionWord[],
  timeSec: number
): number {
  // Linear scan — fine for ~30s of captions (a few hundred words at most).
  // We intentionally pick the LAST word whose start <= time, which keeps the
  // highlight pinned to the most-recently-active word during silent gaps.
  let idx = -1;
  for (let i = 0; i < words.length; i++) {
    if (words[i]!.start <= timeSec) idx = i;
    else break;
  }
  return idx;
}

export const KineticCaption: React.FC<KineticCaptionProps> = ({
  captions,
  frame,
  fps,
  theme,
  windowRadius = 2,
}) => {
  const timeSec = frame / fps;
  const idx = findCurrentWordIndex(captions.words, timeSec);
  if (idx < 0 || captions.words.length === 0) return null;

  const start = Math.max(0, idx - windowRadius);
  const end = Math.min(captions.words.length, idx + windowRadius + 1);
  const visible = captions.words.slice(start, end);

  const containerStyle: React.CSSProperties = {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: theme.captionPosition === "bottom-third" ? "30%" : "50%",
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
    padding: "0 64px",
    fontFamily: theme.font,
    fontWeight: 900,
    fontSize: theme.captionSize,
    color: theme.textPrimary,
    textAlign: "center",
    pointerEvents: "none",
  };

  return (
    <div data-testid="kinetic-caption" style={containerStyle}>
      {visible.map((w, i) => {
        const globalIndex = start + i;
        const isCurrent = globalIndex === idx;
        const startFrame = w.start * fps;
        const scale = isCurrent
          ? interpolate(
              frame,
              [
                startFrame - PULSE_WINDOW_FRAMES / 2,
                startFrame,
                startFrame + PULSE_WINDOW_FRAMES / 2,
              ],
              [1.0, 1.1, 1.0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
            )
          : 1.0;
        return (
          <span
            key={`${globalIndex}-${w.word}`}
            data-current={isCurrent ? "true" : "false"}
            data-word={w.word}
            style={{
              color: isCurrent ? theme.textHighlight : theme.textPrimary,
              transform: `scale(${scale})`,
              transformOrigin: "center",
              WebkitTextStrokeWidth: theme.captionStroke,
              WebkitTextStrokeColor: "#000",
            }}
          >
            {w.word}
          </span>
        );
      })}
    </div>
  );
};
