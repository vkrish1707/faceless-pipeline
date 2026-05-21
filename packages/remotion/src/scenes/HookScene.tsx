import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { ThemeTokens } from "../theme/tokens";
import { SlideUpCard } from "../components/SlideUpCard";

/**
 * Overlay scene for the opening seconds: shows the hook text on a slide-up
 * card. Renders nothing visible if `hookText` is empty so the underlying
 * BeatScene shows through.
 */
export type HookSceneProps = {
  hookText: string;
  theme: ThemeTokens;
};

export const HookScene: React.FC<HookSceneProps> = ({ hookText, theme }) => {
  const frame = useCurrentFrame();
  if (!hookText.trim()) return null;
  return (
    <AbsoluteFill>
      <SlideUpCard text={hookText} frame={frame} theme={theme} align="top" />
    </AbsoluteFill>
  );
};
