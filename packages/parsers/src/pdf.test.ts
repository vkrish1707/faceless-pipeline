import { describe, it, expect } from "vitest";
import { parsePdf } from "./pdf";
import { makeFixturePdf } from "./fixtures";

describe("parsePdf", () => {
  it("returns page count and per-page text in order", async () => {
    const buf = await makeFixturePdf(["Hello page one", "Page two body", "Final third page"]);
    const result = await parsePdf(buf);
    expect(result.pageCount).toBe(3);
    expect(result.pages).toHaveLength(3);
    expect(result.pages[0]).toContain("Hello page one");
    expect(result.pages[1]).toContain("Page two body");
    expect(result.pages[2]).toContain("Final third page");
  });

  it("throws PdfParseError on non-PDF input", async () => {
    await expect(parsePdf(Buffer.from("not a pdf"))).rejects.toThrow(/PdfParseError/);
  });
});
