import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import type { Beat } from "../data/types";
import type { ThemeTokens } from "../theme/tokens";
import { BRollImage } from "../components/BRollImage";
import { BRollVideo } from "../components/BRollVideo";

/**
 * A single visual beat: photo or video b-roll that fills the canvas. The
 * 4-frame outgoing cross-fade is owned here (incoming sequences cover us
 * underneath via z-order).
 */
export type BeatSceneProps = {
  beat: Beat;
  durationFrames: number;
  theme: ThemeTokens;
};

const CROSSFADE_FRAMES = 4;

export const BeatScene: React.FC<BeatSceneProps> = ({ beat, durationFrames, theme }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [Math.max(0, durationFrames - CROSSFADE_FRAMES), durationFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, opacity }}>
      {beat.assetType === "photo" ? (
        <BRollImage src={beat.assetPath} frame={frame} durationFrames={durationFrames} from={theme.bRollKenBurns.from} to={theme.bRollKenBurns.to} />
      ) : (
        <BRollVideo src={beat.assetPath} />
      )}
    </AbsoluteFill>
  );
};
