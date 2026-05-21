import React from "react";
import { spring, useVideoConfig } from "remotion";
import type { ThemeTokens } from "../theme/tokens";

/**
 * Card that slides up from the bottom of the canvas with a spring easing.
 * Used by HookScene and CtaScene to overlay a single line of text over the
 * current b-roll without disrupting the rest of the timeline.
 *
 * `frame` is the LOCAL frame within the parent Sequence so the spring resets
 * at the start of each scene.
 */
export type SlideUpCardProps = {
  text: string;
  frame: number;
  theme: ThemeTokens;
  align?: "top" | "center" | "bottom";
};

export const SlideUpCard: React.FC<SlideUpCardProps> = ({
  text,
  frame,
  theme,
  align = "center",
}) => {
  const { fps } = useVideoConfig();
  const progress = spring({
    fps,
    frame,
    config: { damping: 100, stiffness: 200 },
  });
  // translateY: 100% (off-screen below) → 0%.
  const translateY = `${(1 - progress) * 100}%`;
  const verticalAlign =
    align === "top" ? "20%" : align === "bottom" ? "70%" : "45%";
  return (
    <div
      data-testid="slide-up-card"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: verticalAlign,
        transform: `translateY(${translateY})`,
        display: "flex",
        justifyContent: "center",
        padding: "0 48px",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          backgroundColor: "rgba(11,15,26,0.85)",
          color: theme.textPrimary,
          border: `2px solid ${theme.accent}`,
          borderRadius: 16,
          padding: "24px 32px",
          fontFamily: theme.font,
          fontSize: 64,
          fontWeight: 900,
          lineHeight: 1.1,
          textAlign: "center",
          maxWidth: "85%",
        }}
      >
        {text}
      </div>
    </div>
  );
};
