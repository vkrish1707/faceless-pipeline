// pdf-parse's index.js opens a hard-coded debug PDF; use the deep import to avoid it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
  // pdf-parse v1's bundled pdfjs (v1.10.100) only handles Uint8Array reliably,
  // not Node.js Buffer directly — we convert below.
  buffer: Uint8Array,
  opts?: Record<string, unknown>
) => Promise<{ numpages: number; text: string }>;

export class PdfParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfParseError";
  }
}

export type ParsedPdf = { pageCount: number; pages: string[] };

export async function parsePdf(buffer: Buffer): Promise<ParsedPdf> {
  const pages: string[] = [];

  // pagerender lets us capture per-page text instead of one concatenated string.
  // The function receives a pdfjs PageProxy and should return a Promise<string>.
  // We index by pageIndex (0-based) rather than pushing so that concurrent renders
  // do not reorder pages based on resolution order.
  const pagerender = async (pageData: {
    pageIndex: number;
    pageNumber: number;
    getTextContent: (opts: { normalizeWhitespace: boolean }) => Promise<{
      items: Array<{ str: string; transform: number[] }>;
    }>;
  }): Promise<string> => {
    const tc = await pageData.getTextContent({ normalizeWhitespace: true });
    // Re-flow lines using the y-coordinate (transform[5]) so word order is preserved.
    let lastY: number | null = null;
    let out = "";
    for (const item of tc.items) {
      const y = item.transform[5] ?? 0;
      if (lastY !== null && Math.abs(y - lastY) > 2) out += "\n";
      out += item.str + " ";
      lastY = y;
    }
    // Use pageIndex (0-based) if available; fall back to pageNumber - 1.
    const idx = pageData.pageIndex !== undefined ? pageData.pageIndex : pageData.pageNumber - 1;
    pages[idx] = out.trim();
    return out;
  };

  try {
    // Convert Buffer → Uint8Array so pdf-parse v1's old pdfjs can parse it correctly.
    const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const result = await pdfParse(uint8, { pagerender });
    return { pageCount: result.numpages, pages };
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    throw new PdfParseError(cause);
  }
}
