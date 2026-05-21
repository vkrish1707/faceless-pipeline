import React from "react";
import { OffthreadVideo } from "remotion";

/**
 * Video b-roll. We use `<OffthreadVideo>` (Remotion's recommended primitive for
 * rendered videos — decodes off the main thread, no audio) so the b-roll's own
 * soundtrack doesn't conflict with the script voice-over track.
 */
export type BRollVideoProps = {
  src: string;
  /** Loop if the beat outlasts the clip. */
  loop?: boolean;
};

export const BRollVideo: React.FC<BRollVideoProps> = ({ src, loop = true }) => {
  return (
    <div
      data-testid="broll-video"
      style={{ position: "absolute", inset: 0, overflow: "hidden" }}
    >
      <OffthreadVideo
        src={src}
        muted
        loop={loop}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
    </div>
  );
};
