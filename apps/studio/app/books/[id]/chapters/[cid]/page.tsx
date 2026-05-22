import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ScoreButton } from "./ScoreButton";
import { SuggestionStrip, type SuggestionRow } from "./SuggestionStrip";
import { IdeaGrid, type IdeaRow } from "./IdeaGrid";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { BackButton } from "@/components/BackButton";

export const dynamic = "force-dynamic";

type IdeaBreakdown = {
  hook_strength: number;
  specificity: number;
  trend_alignment: number;
  format_fit: number;
  shelf_life: number;
};

export default async function ChapterIdeasPage({ params }: { params: Promise<{ id: string; cid: string }> }) {
  const { id, cid } = await params;
  const chapter = await db.chapter.findUnique({
    where: { id: cid },
    include: {
      ideas: { where: { status: { not: "dropped" } } },
      book: true,
      suggestions: { where: { status: "open" }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!chapter || chapter.bookId !== id) notFound();

  const sortedIdeas = [...chapter.ideas].sort((a, b) => {
    const sa = a.score ?? -1;
    const sb = b.score ?? -1;
    if (sb !== sa) return sb - sa;
    return a.id.localeCompare(b.id);
  });

  const ideaTitleById = new Map(chapter.ideas.map((i) => [i.id, i.title]));

  const suggestionRows: SuggestionRow[] = chapter.suggestions.map((s) => {
    const payload = (s.payload as Record<string, unknown>) ?? {};
    const ids: string[] = [];
    if (typeof payload.ideaId === "string") ids.push(payload.ideaId);
    if (Array.isArray(payload.ideaIds)) for (const x of payload.ideaIds) if (typeof x === "string") ids.push(x);
    const affectedTitles = ids
      .map((idVal) => ideaTitleById.get(idVal))
      .filter((t): t is string => typeof t === "string");
    return {
      id: s.id,
      kind: s.kind,
      payload,
      reason: s.reason,
      affectedTitles,
    };
  });

  const hasScores = sortedIdeas.some((i) => i.score != null);
  const hasScripted = sortedIdeas.some((i) => i.status === "scripted");

  const ideaRows: IdeaRow[] = sortedIdeas.map((idea) => {
    const trendSignals = idea.trendSignals as { error?: string | null } | null;
    return {
      id: idea.id,
      title: idea.title,
      summary: idea.summary,
      targetLengthSec: idea.targetLengthSec,
      sourceQuotes: (idea.sourceQuotes as string[] | null) ?? [],
      candidateHooks: (idea.candidateHooks as string[] | null) ?? [],
      score: idea.score,
      breakdown: (idea.scoreBreakdown as IdeaBreakdown | null) ?? null,
      trendsPartial: trendSignals?.error === "partial",
      status: idea.status,
    };
  });

  return (
    <main className="max-w-5xl mx-auto p-8 space-y-6">
      <div className="flex items-center gap-3">
        <BackButton fallbackHref={`/books/${id}`} />
        <Breadcrumbs
          items={[
            { label: "Books", href: "/books" },
            { label: chapter.book.title, href: `/books/${id}` },
            { label: chapter.title },
          ]}
        />
      </div>
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">{chapter.title}</h1>
            <p className="text-muted-foreground">
              pp. {chapter.startPage + 1}–{chapter.endPage + 1} · {chapter.ideas.length} ideas
            </p>
          </div>
          <div className="flex items-center gap-3">
            {hasScripted && (
              <Link href={`/books/${id}/chapters/${cid}/scripts`} className="text-sm underline">
                View scripts →
              </Link>
            )}
            <ScoreButton chapterId={chapter.id} ideaCount={chapter.ideas.length} hasScores={hasScores} />
          </div>
        </div>
        {hasScores && !hasScripted && (
          <div className="text-xs text-muted-foreground bg-card/40 border border-border rounded px-3 py-2">
            Next: tick the <span className="text-foreground">Approve</span> checkbox on the ideas you want, then click <span className="text-foreground">Generate scripts</span>.
          </div>
        )}
      </header>

      <SuggestionStrip suggestions={suggestionRows} />

      <IdeaGrid bookId={id} chapterId={cid} ideas={ideaRows} hasScores={hasScores} />
    </main>
  );
}
