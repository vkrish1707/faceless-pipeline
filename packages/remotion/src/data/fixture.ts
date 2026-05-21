import type { RenderInput } from "./types";

/**
 * Default props for the Remotion preview UI. Never used during real renders —
 * the studio passes a `--props=<json>` file built by `buildRenderInput`.
 *
 * Paths are intentionally relative placeholders. The preview will simply fail
 * to load the audio/asset if you click around without setting up assets, but
 * the composition shape itself renders fine.
 */
export const previewFixture: RenderInput = {
  scriptId: "preview",
  durationFrames: 60,
  fps: 30,
  width: 1080,
  height: 1920,
  audioPath: "/dev/null",
  captions: {
    words: [
      { word: "Hello", start: 0.0, end: 0.5 },
      { word: "world", start: 0.5, end: 1.0 },
    ],
  },
  visualBeats: [
    {
      start: 0,
      end: 2,
      tone: "explainer",
      assetPath: "/dev/null",
      assetType: "photo",
    },
  ],
  theme: "finance-dark",
  metadata: {
    youtubeTitle: "Preview",
    caption: "preview",
    hashtags: ["#preview"],
    thumbnailConcept: "preview",
  },
  hookText: "Preview Hook",
  ctaText: "Preview CTA",
};
