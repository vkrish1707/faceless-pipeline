import React from "react";
import { Composition } from "remotion";
import { Video } from "./Video";
import { HelloVideo } from "./HelloVideo";
import { previewFixture } from "./data/fixture";

/**
 * The composition registry. Two entries:
 *
 *  - "Video"      — the real Phase 6 composition. `durationInFrames` is
 *                   recomputed at render time from the props via
 *                   `calculateMetadata`, so the CLI's --props file fully drives
 *                   length. The fallback (1800 frames / 60s) keeps the preview
 *                   UI happy when no props are passed.
 *  - "HelloVideo" — the original Phase 0 smoke composition. Kept for
 *                   `pnpm smoke:remotion`, which is a much faster sanity check
 *                   than spinning up the full Video composition.
 */
export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Video"
      component={Video}
      durationInFrames={1800}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={previewFixture}
      calculateMetadata={({ props }) => ({
        durationInFrames: props.durationFrames || 1800,
        fps: 30,
        width: 1080,
        height: 1920,
      })}
    />
    <Composition
      id="HelloVideo"
      component={HelloVideo}
      durationInFrames={60}
      fps={30}
      width={1080}
      height={1920}
    />
  </>
);
