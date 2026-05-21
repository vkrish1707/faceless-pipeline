import { describe, it, expect } from "vitest";
import { rankResults } from "./rank";
import type { PexelsPhotoResult, PexelsVideoResult } from "./pexels";

function photo(p: Partial<PexelsPhotoResult> & { id: number; width: number; height: number }): PexelsPhotoResult {
  return { id: p.id, thumb: "", full: "", alt: "", width: p.width, height: p.height };
}

function video(v: Partial<PexelsVideoResult> & { id: number; width: number; height: number; durationSec: number }): PexelsVideoResult {
  return { id: v.id, thumb: "", full: "", width: v.width, height: v.height, durationSec: v.durationSec };
}

describe("rankResults photos", () => {
  it("ranks 9:16 photos higher than square", () => {
    const items = [
      photo({ id: 1, width: 1080, height: 1080 }), // square (1/1)
      photo({ id: 2, width: 1080, height: 1920 }), // 9:16 exact
      photo({ id: 3, width: 1920, height: 1080 }), // 16:9
    ];
    const out = rankResults({ items, mediaType: "photo" });
    expect(out.map((p) => p.id)).toEqual([2, 1, 3]);
  });

  it("tie-breaks by id ascending", () => {
    const items = [
      photo({ id: 5, width: 1080, height: 1920 }),
      photo({ id: 2, width: 1080, height: 1920 }),
      photo({ id: 9, width: 1080, height: 1920 }),
    ];
    const out = rankResults({ items, mediaType: "photo" });
    expect(out.map((p) => p.id)).toEqual([2, 5, 9]);
  });

  it("takes the top 5 from a larger list", () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      photo({ id: i, width: 1080, height: 1920 })
    );
    const out = rankResults({ items, mediaType: "photo" });
    expect(out).toHaveLength(5);
    expect(out.map((p) => p.id)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("rankResults videos", () => {
  it("excludes videos longer than 30s", () => {
    const items = [
      video({ id: 1, width: 1080, height: 1920, durationSec: 12 }),
      video({ id: 2, width: 1080, height: 1920, durationSec: 45 }),
      video({ id: 3, width: 1080, height: 1920, durationSec: 8 }),
    ];
    const out = rankResults({ items, mediaType: "video" });
    expect(out.map((v) => v.id)).toEqual([1, 3]);
  });

  it("excludes videos shorter than 1080 height", () => {
    const items = [
      video({ id: 1, width: 540, height: 960, durationSec: 10 }),
      video({ id: 2, width: 1080, height: 1920, durationSec: 10 }),
    ];
    const out = rankResults({ items, mediaType: "video" });
    expect(out.map((v) => v.id)).toEqual([2]);
  });

  it("ranks 9:16 videos higher and tie-breaks by id", () => {
    const items = [
      video({ id: 7, width: 1080, height: 1920, durationSec: 10 }),
      video({ id: 3, width: 1080, height: 1920, durationSec: 10 }),
      video({ id: 5, width: 1080, height: 1080, durationSec: 10 }), // square but height>=1080
    ];
    const out = rankResults({ items, mediaType: "video" });
    expect(out.map((v) => v.id)).toEqual([3, 7, 5]);
  });

  it("returns at most 5", () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      video({ id: i, width: 1080, height: 1920, durationSec: 10 })
    );
    const out = rankResults({ items, mediaType: "video" });
    expect(out).toHaveLength(5);
  });
});
