import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { RenderInput } from "./data/types";
import { themeFor } from "./theme/finance";
import { BeatScene } from "./scenes/BeatScene";
import { ChartScene } from "./scenes/ChartScene";
import { HookScene } from "./scenes/HookScene";
import { CtaScene } from "./scenes/CtaScene";
import { KineticCaption } from "./components/KineticCaption";

/**
 * Top-level composition. Renders, in z-order:
 *
 *   1. one Sequence per visual beat (BeatScene / ChartScene),
 *   2. HookScene over the first 3s,
 *   3. CtaScene over the last 2s,
 *   4. KineticCaption across the whole timeline,
 *   5. the script's voice-over Audio track.
 *
 * Props arrive via Remotion's `--props=<json>` CLI flag, which means
 * `defaultProps` on `<Composition>` is only used by the studio preview UI. We
 * accept them as direct component props so unit tests can mount this directly.
 */
const HOOK_SECONDS = 3;
const CTA_SECONDS = 2;

export const Video: React.FC<RenderInput> = (input) => {
  const { fps } = useVideoConfig();
  const theme = themeFor(input.theme);
  const frame = useCurrentFrame();

  const hookDurationFrames = Math.round(HOOK_SECONDS * fps);
  const ctaStart = Math.max(0, input.durationFrames - Math.round(CTA_SECONDS * fps));
  const ctaDurationFrames = Math.max(1, input.durationFrames - ctaStart);

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      {input.visualBeats.map((beat, i) => {
        const fromFrame = Math.round(beat.start * fps);
        const toFrame = Math.round(beat.end * fps);
        const durationFrames = Math.max(1, toFrame - fromFrame);
        return (
          <Sequence
            key={`beat-${i}`}
            from={fromFrame}
            durationInFrames={durationFrames}
            name={`beat-${i}`}
          >
            {beat.chart ? (
              <ChartScene beat={beat} durationFrames={durationFrames} theme={theme} />
            ) : (
              <BeatScene beat={beat} durationFrames={durationFrames} theme={theme} />
            )}
          </Sequence>
        );
      })}

      {input.hookText && (
        <Sequence from={0} durationInFrames={hookDurationFrames} name="hook">
          <HookScene hookText={input.hookText} theme={theme} />
        </Sequence>
      )}

      {input.ctaText && (
        <Sequence from={ctaStart} durationInFrames={ctaDurationFrames} name="cta">
          <CtaScene
            ctaText={input.ctaText}
            thumbnailConcept={input.metadata?.thumbnailConcept}
            theme={theme}
          />
        </Sequence>
      )}

      <KineticCaption captions={input.captions} frame={frame} fps={fps} theme={theme} />

      <Audio src={input.audioPath} />
    </AbsoluteFill>
  );
};
