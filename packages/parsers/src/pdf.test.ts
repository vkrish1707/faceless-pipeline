import { describe, it, expect } from "vitest";
import { parsePdf } from "./pdf";
import { makeFixturePdf } from "./fixtures";

describe("parsePdf", () => {
  it("returns page count and per-page text in order", async () => {
    const buf = await makeFixturePdf([
      "Hello page one UNIQUE_ALPHA",
      "Page two body UNIQUE_BETA",
      "Final third page UNIQUE_GAMMA",
    ]);
    const result = await parsePdf(buf);
    expect(result.pageCount).toBe(3);
    expect(result.pages).toHaveLength(3);
    expect(result.pages[0]).toContain("UNIQUE_ALPHA");
    expect(result.pages[1]).toContain("UNIQUE_BETA");
    expect(result.pages[2]).toContain("UNIQUE_GAMMA");
  });

  it("throws PdfParseError on non-PDF input", async () => {
    await expect(parsePdf(Buffer.from("not a pdf"))).rejects.toThrow(
      expect.objectContaining({ name: "PdfParseError" })
    );
  });
});
