import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ScriptCard, type ScriptCardData } from "./ScriptCard";

export const dynamic = "force-dynamic";

export default async function ScriptsReviewPage({ params }: { params: Promise<{ id: string; cid: string }> }) {
  const { id, cid } = await params;
  const chapter = await db.chapter.findUnique({
    where: { id: cid },
    include: {
      book: true,
      ideas: {
        where: { status: { in: ["approved", "scripted"] } },
        include: { script: { include: { render: true } } },
      },
    },
  });
  if (!chapter || chapter.bookId !== id) notFound();

  const cards: ScriptCardData[] = chapter.ideas.map((idea) => ({
    ideaId: idea.id,
    ideaTitle: idea.title,
    targetLengthSec: idea.targetLengthSec,
    script: idea.script
      ? {
          id: idea.script.id,
          hook: idea.script.hook,
          body: idea.script.body,
          cta: idea.script.cta,
          score: idea.script.score,
          visualBeats: ((idea.script.visualBeats as unknown) as ScriptCardData["script"] extends infer S ? S extends { visualBeats: infer B } ? B : never : never) ?? [],
          metadata: ((idea.script.metadata as unknown) as ScriptCardData["script"] extends infer S ? S extends { metadata: infer M } ? M : never : never) ?? {
            youtubeTitle: "",
            caption: "",
            hashtags: [],
            thumbnailConcept: "",
          },
          warnings: (idea.script.warnings as Array<{ kind: string; detail: string }> | null) ?? [],
          lastEditedAt: idea.script.lastEditedAt ? idea.script.lastEditedAt.toISOString() : null,
          generatedAt: idea.script.generatedAt ? idea.script.generatedAt.toISOString() : null,
          render: idea.script.render
            ? {
                id: idea.script.render.id,
                status: idea.script.render.status,
                progress: idea.script.render.progress,
                error: idea.script.render.error,
                warning: idea.script.render.warning,
                audioUrl: idea.script.render.audioPath ? `/api/renders/${idea.script.render.id}/audio` : null,
                captionsUrl: idea.script.render.captionsPath ? `/api/renders/${idea.script.render.id}/captions` : null,
                durationSec: idea.script.render.durationSec,
              }
            : null,
        }
      : null,
  }));

  return (
    <main className="max-w-6xl mx-auto p-8 space-y-6">
      <header className="space-y-2">
        <Link href={`/books/${id}/chapters/${cid}`} className="text-sm text-muted-foreground hover:underline">
          ← {chapter.title}
        </Link>
        <h1 className="text-3xl font-bold">Scripts</h1>
        <p className="text-muted-foreground">{cards.length} approved ideas · {cards.filter((c) => c.script).length} scripts ready</p>
      </header>

      {cards.length === 0 ? (
        <p className="text-muted-foreground">
          No approved ideas yet. Approve some on the <Link className="underline" href={`/books/${id}/chapters/${cid}`}>chapter page</Link> first.
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {cards.map((c) => (
            <ScriptCard key={c.ideaId} data={c} />
          ))}
        </div>
      )}
    </main>
  );
}
