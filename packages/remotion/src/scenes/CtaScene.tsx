import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { ThemeTokens } from "../theme/tokens";
import { SlideUpCard } from "../components/SlideUpCard";

/**
 * Overlay scene for the closing seconds. Shows the CTA text and a thumbnail
 * concept teaser. The underlying BeatScene continues to play below.
 */
export type CtaSceneProps = {
  ctaText: string;
  thumbnailConcept?: string;
  theme: ThemeTokens;
};

export const CtaScene: React.FC<CtaSceneProps> = ({ ctaText, thumbnailConcept, theme }) => {
  const frame = useCurrentFrame();
  if (!ctaText.trim()) return null;
  return (
    <AbsoluteFill>
      <SlideUpCard text={ctaText} frame={frame} theme={theme} align="center" />
      {thumbnailConcept && thumbnailConcept.trim() && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 96,
            display: "flex",
            justifyContent: "center",
            padding: "0 48px",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              fontFamily: theme.font,
              fontSize: 32,
              color: theme.accent,
              fontWeight: 600,
              textAlign: "center",
              opacity: 0.85,
            }}
          >
            {thumbnailConcept}
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
