import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ChapterEditor } from "./ChapterEditor";

export const dynamic = "force-dynamic";

export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const book = await db.book.findUnique({
    where: { id },
    include: {
      chapters: {
        orderBy: { orderIndex: "asc" },
        include: { _count: { select: { ideas: true } } },
      },
    },
  });
  if (!book) notFound();

  const chapters = book.chapters.map((c) => ({
    id: c.id,
    title: c.title,
    orderIndex: c.orderIndex,
    startPage: c.startPage,
    endPage: c.endPage,
    wordCount: c.rawText.trim().split(/\s+/).filter(Boolean).length,
    status: c.status,
    ideaCount: c._count.ideas,
    rawText: c.rawText,
  }));

  return (
    <main className="max-w-4xl mx-auto p-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">{book.title}</h1>
        <p className="text-muted-foreground mt-1">
          {book.niche.replace("_", " ")} · {book.pageCount} pages · {chapters.length} chapters
        </p>
      </header>
      <ChapterEditor bookId={book.id} initialChapters={chapters} />
    </main>
  );
}
