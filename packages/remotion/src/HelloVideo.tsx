import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";

export const HelloVideo: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 15, 45, 60], [0, 1, 1, 0]);
  return (
    <AbsoluteFill style={{ backgroundColor: "#0B0F1A", color: "#00FF85", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontFamily: "sans-serif", fontSize: 120, fontWeight: 900, opacity }}>
        PIPELINE OK
      </div>
    </AbsoluteFill>
  );
};
