import React from "react";
import { Img, interpolate } from "remotion";

/**
 * Photo b-roll with a ken-burns zoom: scale interpolates from 1.0 → 1.08 over
 * the full beat duration. We intentionally cover the entire frame so 16:9
 * photos centre-crop into the 9:16 canvas without letterboxing.
 *
 * The `frame` prop is the LOCAL frame within the beat's sequence, so consumers
 * pass `useCurrentFrame()` from inside the parent `<Sequence>`.
 */
export type BRollImageProps = {
  src: string;
  frame: number;
  durationFrames: number;
  from?: number;
  to?: number;
};

export const BRollImage: React.FC<BRollImageProps> = ({
  src,
  frame,
  durationFrames,
  from = 1.0,
  to = 1.08,
}) => {
  const scale = interpolate(
    frame,
    [0, Math.max(1, durationFrames)],
    [from, to],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  return (
    <div
      data-testid="broll-image"
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
      }}
    >
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale})`,
          transformOrigin: "center",
        }}
      />
    </div>
  );
};
