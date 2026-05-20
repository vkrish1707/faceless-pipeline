import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchPhotos } from "./pexels";

describe("searchPhotos", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls Pexels /v1/search with the query and returns normalized results", async () => {
    const fakeRes = {
      photos: [
        { id: 1, src: { large: "https://img.pexels.com/1-large.jpg", medium: "https://img.pexels.com/1-med.jpg" }, alt: "money" },
        { id: 2, src: { large: "https://img.pexels.com/2-large.jpg", medium: "https://img.pexels.com/2-med.jpg" }, alt: "chart" },
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
    expect(results).toEqual([
      { id: 1, thumb: "https://img.pexels.com/1-med.jpg", full: "https://img.pexels.com/1-large.jpg", alt: "money" },
      { id: 2, thumb: "https://img.pexels.com/2-med.jpg", full: "https://img.pexels.com/2-large.jpg", alt: "chart" },
    ]);
  });

  it("throws a clear error on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 401 }));
    await expect(searchPhotos("x", { apiKey: "bad" })).rejects.toThrow(/Pexels 401/);
  });
});
