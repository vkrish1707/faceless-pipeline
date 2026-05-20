import { PDFDocument, StandardFonts } from "pdf-lib";

export async function makeFixturePdf(pages: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([612, 792]);
    const lines = text.split("\n");
    let y = 750;
    for (const line of lines) {
      page.drawText(line, { x: 50, y, size: 12, font });
      y -= 16;
    }
  }
  return Buffer.from(await doc.save());
}
