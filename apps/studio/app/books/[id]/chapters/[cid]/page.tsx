import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { IdeaCard } from "./IdeaCard";

export const dynamic = "force-dynamic";

export default async function ChapterIdeasPage({ params }: { params: Promise<{ id: string; cid: string }> }) {
  const { id, cid } = await params;
  const chapter = await db.chapter.findUnique({
    where: { id: cid },
    include: { ideas: { orderBy: { id: "asc" } }, book: true },
  });
  if (!chapter || chapter.bookId !== id) notFound();

  return (
    <main className="max-w-5xl mx-auto p-8 space-y-6">
      <header className="space-y-2">
        <Link href={`/books/${id}`} className="text-sm text-muted-foreground hover:underline">← {chapter.book.title}</Link>
        <h1 className="text-3xl font-bold">{chapter.title}</h1>
        <p className="text-muted-foreground">
          pp. {chapter.startPage + 1}–{chapter.endPage + 1} · {chapter.ideas.length} ideas
        </p>
      </header>
      {chapter.ideas.length === 0 ? (
        <p className="text-muted-foreground">No ideas yet. Click &quot;Extract ideas&quot; on the chapter list.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {chapter.ideas.map((idea) => (
            <IdeaCard
              key={idea.id}
              title={idea.title}
              summary={idea.summary}
              targetLengthSec={idea.targetLengthSec}
              sourceQuotes={(idea.sourceQuotes as string[] | null) ?? []}
              candidateHooks={(idea.candidateHooks as string[] | null) ?? []}
            />
          ))}
        </div>
      )}
    </main>
  );
}
