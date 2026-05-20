import { NextResponse } from "next/server";
import { parsePdf, detectChapters, PdfParseError, NoChaptersDetectedError } from "@studio/parsers";
import { db } from "@/lib/db";
import { writePdfFile, deletePdfFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

const MAX_SIZE_BYTES = 50 * 1024 * 1024;
const ALLOWED_NICHES = ["personal_finance", "investing", "entrepreneurship", "psychology", "other"];

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  const niche = String(form.get("niche") ?? "");
  const titleOverride = String(form.get("title") ?? "").trim();

  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "file is empty" }, { status: 400 });
  if (file.size > MAX_SIZE_BYTES) return NextResponse.json({ error: "file exceeds 50MB" }, { status: 400 });
  if (!ALLOWED_NICHES.includes(niche)) return NextResponse.json({ error: "invalid niche" }, { status: 400 });

  if (file.type && file.type !== "application/pdf") {
    return NextResponse.json({ error: "file must be application/pdf" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!buffer.slice(0, 5).equals(Buffer.from("%PDF-"))) {
    return NextResponse.json({ error: "not a PDF (missing magic bytes)" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = await parsePdf(buffer);
  } catch (e) {
    const msg = e instanceof PdfParseError ? e.message : "failed to parse PDF";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  let chapters;
  try {
    chapters = detectChapters(parsed.pages);
  } catch (e) {
    if (e instanceof NoChaptersDetectedError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }

  // Derive a default title from filename if not overridden.
  const defaultTitle = file.name.replace(/\.pdf$/i, "").trim() || "Untitled";
  const title = titleOverride || defaultTitle;

  const book = await db.book.create({
    data: { title, filePath: "", niche, pageCount: parsed.pageCount, status: "ready" },
  });

  try {
    const filePath = await writePdfFile(book.id, buffer);
    await db.$transaction(async (tx) => {
      await tx.book.update({ where: { id: book.id }, data: { filePath } });
      for (const c of chapters) {
        await tx.chapter.create({
          data: {
            bookId: book.id,
            title: c.title,
            orderIndex: c.orderIndex,
            startPage: c.startPage,
            endPage: c.endPage,
            rawText: c.rawText,
            status: "pending",
          },
        });
      }
    });
  } catch (e) {
    // Roll back: delete the Book row and any chapters, plus the file on disk.
    await db.chapter.deleteMany({ where: { bookId: book.id } });
    await db.book.delete({ where: { id: book.id } });
    await deletePdfFile(book.id);
    throw e;
  }

  return NextResponse.json({ bookId: book.id, chapterCount: chapters.length });
}
