import { describe, it, expect } from "vitest";
import { pickTrack, TONE_TO_TRACK, DEFAULT_TRACK } from "./pickTrack";

describe("pickTrack", () => {
  it("returns the modal tone's track", () => {
    const beats = [
      { tone: "urgent" },
      { tone: "urgent" },
      { tone: "payoff" },
    ];
    const picked = pickTrack(beats, { trackRoot: "/m" });
    expect(picked.tone).toBe("urgent");
    expect(picked.trackFile).toBe(TONE_TO_TRACK.urgent);
    expect(picked.path).toBe(`/m/${TONE_TO_TRACK.urgent}`);
  });

  it("falls back to neutral_groove when beats are empty", () => {
    expect(pickTrack([], { trackRoot: "/m" }).trackFile).toBe(DEFAULT_TRACK);
  });

  it("falls back to neutral when no recognised tone is present", () => {
    const picked = pickTrack([{ tone: "weird" }, {}], { trackRoot: "/m" });
    expect(picked.tone).toBe("neutral");
    expect(picked.trackFile).toBe(DEFAULT_TRACK);
  });

  it("tie-break: urgent wins over explainer at equal counts", () => {
    const beats = [
      { tone: "urgent" },
      { tone: "explainer" },
    ];
    expect(pickTrack(beats, { trackRoot: "/m" }).tone).toBe("urgent");
  });

  it("tie-break: explainer wins over payoff at equal counts", () => {
    const beats = [
      { tone: "explainer" },
      { tone: "payoff" },
    ];
    expect(pickTrack(beats, { trackRoot: "/m" }).tone).toBe("explainer");
  });

  it("explainer-heavy mix routes to calm_focus", () => {
    const beats = [
      { tone: "explainer" },
      { tone: "explainer" },
      { tone: "explainer" },
      { tone: "urgent" },
    ];
    expect(pickTrack(beats, { trackRoot: "/m" }).trackFile).toBe("calm_focus.mp3");
  });

  it("cinematic mode resolves to cinematic_swell", () => {
    const beats = [
      { tone: "cinematic" },
      { tone: "cinematic" },
    ];
    expect(pickTrack(beats, { trackRoot: "/m" }).trackFile).toBe("cinematic_swell.mp3");
  });
});
