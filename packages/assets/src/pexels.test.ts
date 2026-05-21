import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchPhotos, searchVideos } from "./pexels";

describe("searchPhotos", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls Pexels /v1/search with the query and returns normalized results", async () => {
    const fakeRes = {
      photos: [
        {
          id: 1,
          width: 1080,
          height: 1920,
          src: { large: "https://img.pexels.com/1-large.jpg", medium: "https://img.pexels.com/1-med.jpg" },
          alt: "money",
        },
        {
          id: 2,
          width: 1080,
          height: 1080,
          src: { large: "https://img.pexels.com/2-large.jpg", medium: "https://img.pexels.com/2-med.jpg" },
          alt: "chart",
        },
      ],
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(fakeRes), { status: 200 })
    );

    const results = await searchPhotos("money", { apiKey: "test-key", perPage: 2 });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const url = fetchSpy.mock.calls[0]?.[0] as string;
    expect(url).toContain("query=money");
    expect(url).toContain("per_page=2");
    expect(url).toContain("orientation=portrait");
    expect(url).toContain("size=large");
    expect(results).toEqual([
      { id: 1, thumb: "https://img.pexels.com/1-med.jpg", full: "https://img.pexels.com/1-large.jpg", alt: "money", width: 1080, height: 1920 },
      { id: 2, thumb: "https://img.pexels.com/2-med.jpg", full: "https://img.pexels.com/2-large.jpg", alt: "chart", width: 1080, height: 1080 },
    ]);
  });

  it("throws a clear error on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 401 }));
    await expect(searchPhotos("x", { apiKey: "bad" })).rejects.toThrow(/Pexels 401/);
  });

  it("retries on 5xx and eventually succeeds", async () => {
    const success = {
      photos: [{ id: 1, width: 1080, height: 1920, src: { large: "L", medium: "M" }, alt: "" }],
    };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("boom", { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(success), { status: 200 }));
    const out = await searchPhotos("x", { apiKey: "k" });
    expect(out).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("searchVideos", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls Pexels /videos/search and picks the smallest portrait-HD video_file", async () => {
    const fakeRes = {
      videos: [
        {
          id: 11,
          width: 1080,
          height: 1920,
          duration: 12,
          image: "https://img.pexels.com/v11-thumb.jpg",
          video_files: [
            { id: 1, width: 540, height: 960, link: "low.mp4" },
            { id: 2, width: 720, height: 1280, link: "med.mp4" },
            { id: 3, width: 1080, height: 1920, link: "hd.mp4" },
            { id: 4, width: 2160, height: 3840, link: "uhd.mp4" },
          ],
        },
      ],
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(fakeRes), { status: 200 })
    );

    const out = await searchVideos("forest", { apiKey: "k", perPage: 1 });

    const url = fetchSpy.mock.calls[0]?.[0] as string;
    expect(url).toContain("videos/search");
    expect(url).toContain("query=forest");
    expect(url).toContain("orientation=portrait");
    // Smallest video_file with height>=1080 and width<=1280: the 720x1280 "med.mp4".
    expect(out).toEqual([
      {
        id: 11,
        thumb: "https://img.pexels.com/v11-thumb.jpg",
        full: "med.mp4",
        width: 720,
        height: 1280,
        durationSec: 12,
      },
    ]);
  });

  it("falls back to closest match if no portrait HD file qualifies", async () => {
    // All video_files are too small (height < 1080).
    const fakeRes = {
      videos: [
        {
          id: 22,
          width: 540,
          height: 960,
          duration: 8,
          image: "thumb.jpg",
          video_files: [
            { id: 1, width: 270, height: 480, link: "lo.mp4" },
            { id: 2, width: 540, height: 960, link: "mid.mp4" },
          ],
        },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(fakeRes), { status: 200 }));
    const out = await searchVideos("x", { apiKey: "k" });
    // 540x960 is closer to target (1080,1280) than 270x480.
    expect(out[0]!.full).toBe("mid.mp4");
  });

  it("retries on 5xx and eventually succeeds", async () => {
    const success = {
      videos: [
        {
          id: 1,
          width: 1080,
          height: 1920,
          duration: 5,
          image: "t.jpg",
          video_files: [{ width: 1080, height: 1920, link: "ok.mp4" }],
        },
      ],
    };
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("boom", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(success), { status: 200 }));
    const out = await searchVideos("x", { apiKey: "k" });
    expect(out).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("throws on non-retried non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 401 }));
    await expect(searchVideos("x", { apiKey: "bad" })).rejects.toThrow(/Pexels 401/);
  });
});
