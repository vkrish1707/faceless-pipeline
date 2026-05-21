import React from "react";
import { Easing, interpolate } from "remotion";
import type { ChartSpec } from "../data/types";
import type { ThemeTokens } from "../theme/tokens";

/**
 * Animated SVG chart overlay. Three variants:
 *
 * - `stat`  — large headline number + label. Fade + zoom-in over 12 frames.
 * - `bar`   — 2-4 vertical bars whose `height` grows from 0 → target%, with a
 *             6-frame stagger between bars and a 1-1-bezier ease.
 * - `line`  — single SVG `<path>` with `strokeDasharray` animated 0 → length,
 *             the classic "line draw" SVG technique.
 *
 * `frame` is the LOCAL frame within the beat sequence, so the animation
 * restarts when the parent Sequence enters.
 */
export type ChartRevealProps = {
  spec: ChartSpec;
  frame: number;
  theme: ThemeTokens;
  width?: number;
  height?: number;
};

const BAR_STAGGER_FRAMES = 6;
const BAR_GROW_FRAMES = 18;
const STAT_REVEAL_FRAMES = 12;
const LINE_DRAW_FRAMES = 24;

export const ChartReveal: React.FC<ChartRevealProps> = ({
  spec,
  frame,
  theme,
  width = 900,
  height = 600,
}) => {
  if (spec.kind === "stat") return <StatReveal spec={spec} frame={frame} theme={theme} width={width} height={height} />;
  if (spec.kind === "bar") return <BarReveal spec={spec} frame={frame} theme={theme} width={width} height={height} />;
  return <LineReveal spec={spec} frame={frame} theme={theme} width={width} height={height} />;
};

const Container: React.FC<{ children: React.ReactNode; width: number; height: number }> = ({ children, width, height }) => (
  <div
    data-testid="chart-reveal"
    style={{
      position: "absolute",
      inset: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ overflow: "visible" }}
    >
      {children}
    </svg>
  </div>
);

export const StatReveal: React.FC<ChartRevealProps> = ({ spec, frame, theme, width = 900, height = 600 }) => {
  const opacity = interpolate(frame, [0, STAT_REVEAL_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scale = interpolate(frame, [0, STAT_REVEAL_FRAMES], [0.9, 1.0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <Container width={width} height={height}>
      <g
        data-variant="stat"
        opacity={opacity}
        transform={`translate(${width / 2} ${height / 2}) scale(${scale}) translate(${-width / 2} ${-height / 2})`}
      >
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily={theme.font}
          fontWeight={900}
          fontSize={240}
          fill={theme.textHighlight}
        >
          {spec.bigNumber ?? "—"}
        </text>
        <text
          x={width / 2}
          y={height / 2 + 160}
          textAnchor="middle"
          fontFamily={theme.font}
          fontWeight={700}
          fontSize={64}
          fill={theme.textPrimary}
        >
          {spec.label}
        </text>
      </g>
    </Container>
  );
};

export const BarReveal: React.FC<ChartRevealProps> = ({ spec, frame, theme, width = 900, height = 600 }) => {
  const data = (spec.data ?? []).slice(0, 4);
  const count = Math.max(1, data.length);
  const maxVal = Math.max(...data, 1);
  const barWidth = (width - 100) / count - 40;
  const baseY = height - 100;
  const usableHeight = height - 200;
  return (
    <Container width={width} height={height}>
      <g data-variant="bar">
        {data.map((value, i) => {
          const localFrame = frame - i * BAR_STAGGER_FRAMES;
          const targetHeight = (value / maxVal) * usableHeight;
          const grown = interpolate(localFrame, [0, BAR_GROW_FRAMES], [0, targetHeight], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          });
          const x = 60 + i * (barWidth + 40);
          return (
            <g key={i}>
              <rect
                x={x}
                y={baseY - grown}
                width={barWidth}
                height={grown}
                fill={theme.textHighlight}
                rx={8}
              />
              <text
                x={x + barWidth / 2}
                y={baseY + 40}
                textAnchor="middle"
                fontFamily={theme.font}
                fontWeight={700}
                fontSize={32}
                fill={theme.textPrimary}
              >
                {String(value)}
              </text>
            </g>
          );
        })}
        <text
          x={width / 2}
          y={60}
          textAnchor="middle"
          fontFamily={theme.font}
          fontWeight={900}
          fontSize={56}
          fill={theme.textPrimary}
        >
          {spec.label}
        </text>
      </g>
    </Container>
  );
};

export const LineReveal: React.FC<ChartRevealProps> = ({ spec, frame, theme, width = 900, height = 600 }) => {
  const data = (spec.data ?? []).slice();
  if (data.length < 2) data.push(...Array(2 - data.length).fill(0));
  const count = data.length;
  const maxVal = Math.max(...data, 1);
  const minVal = Math.min(...data, 0);
  const span = Math.max(1, maxVal - minVal);
  const xStep = (width - 120) / Math.max(1, count - 1);
  const points = data.map((v, i) => {
    const x = 60 + i * xStep;
    const y = height - 100 - ((v - minVal) / span) * (height - 200);
    return [x, y];
  });
  const d = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  // Approximate path length via straight-line summation. Good enough for
  // strokeDasharray reveal — exact pixel length isn't needed.
  let totalLength = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]![0] - points[i - 1]![0];
    const dy = points[i]![1] - points[i - 1]![1];
    totalLength += Math.sqrt(dx * dx + dy * dy);
  }
  const drawn = interpolate(frame, [0, LINE_DRAW_FRAMES], [0, totalLength], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <Container width={width} height={height}>
      <g data-variant="line">
        <path
          d={d}
          stroke={theme.textHighlight}
          strokeWidth={10}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={`${totalLength} ${totalLength}`}
          strokeDashoffset={totalLength - drawn}
        />
        <text
          x={width / 2}
          y={60}
          textAnchor="middle"
          fontFamily={theme.font}
          fontWeight={900}
          fontSize={56}
          fill={theme.textPrimary}
        >
          {spec.label}
        </text>
      </g>
    </Container>
  );
};
