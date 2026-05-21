import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import type { Beat } from "../data/types";
import type { ThemeTokens } from "../theme/tokens";
import { BRollImage } from "../components/BRollImage";
import { BRollVideo } from "../components/BRollVideo";
import { ChartReveal } from "../components/ChartReveal";

/**
 * A beat that has a `chart` spec attached. The b-roll still plays underneath
 * (dimmed to 35% so the chart pops), and the ChartReveal overlay animates in.
 */
export type ChartSceneProps = {
  beat: Beat;
  durationFrames: number;
  theme: ThemeTokens;
};

const CROSSFADE_FRAMES = 4;

export const ChartScene: React.FC<ChartSceneProps> = ({ beat, durationFrames, theme }) => {
  if (!beat.chart) {
    // Defensive — caller should only route here for beats with chart set.
    return <AbsoluteFill style={{ backgroundColor: theme.bg }} />;
  }
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [Math.max(0, durationFrames - CROSSFADE_FRAMES), durationFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, opacity }}>
      <div style={{ position: "absolute", inset: 0, opacity: 0.35 }}>
        {beat.assetType === "photo" ? (
          <BRollImage src={beat.assetPath} frame={frame} durationFrames={durationFrames} from={theme.bRollKenBurns.from} to={theme.bRollKenBurns.to} />
        ) : (
          <BRollVideo src={beat.assetPath} />
        )}
      </div>
      <ChartReveal spec={beat.chart} frame={frame} theme={theme} />
    </AbsoluteFill>
  );
};
