import { describe, it, expect } from "vitest";
import { buildMixArgs, DEFAULT_GAIN_DB } from "./mixArgs";

describe("buildMixArgs", () => {
  it("includes the canonical filter graph with the requested gain", () => {
    const args = buildMixArgs({
      videoPath: "/in/video.mp4",
      musicPath: "/m/track.mp3",
      outPath: "/out/video.mixed.mp4",
      gainDb: -20,
    });
    expect(args).toEqual([
      "-y",
      "-i",
      "/in/video.mp4",
      "-i",
      "/m/track.mp3",
      "-filter_complex",
      "[1:a]volume=-20dB,aloop=loop=-1:size=2e9[bg];[0:a][bg]amix=inputs=2:duration=shortest[a]",
      "-map",
      "0:v",
      "-map",
      "[a]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "/out/video.mixed.mp4",
    ]);
  });

  it("defaults to -18 dB when gainDb is omitted", () => {
    const args = buildMixArgs({
      videoPath: "/v",
      musicPath: "/m",
      outPath: "/o",
    });
    expect(args).toContain(`[1:a]volume=${DEFAULT_GAIN_DB}dB,aloop=loop=-1:size=2e9[bg];[0:a][bg]amix=inputs=2:duration=shortest[a]`);
  });

  it("falls back to the default when given a non-finite gain", () => {
    const args = buildMixArgs({
      videoPath: "/v",
      musicPath: "/m",
      outPath: "/o",
      gainDb: Number.NaN,
    });
    const filter = args[args.indexOf("-filter_complex") + 1]!;
    expect(filter).toContain(`volume=${DEFAULT_GAIN_DB}dB`);
  });
});
