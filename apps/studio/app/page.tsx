import Link from "next/link";
import { db } from "@/lib/db";
import { SystemStatus } from "@/components/system-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

type BookSummary = {
  id: string;
  title: string;
  niche: string;
  pageCount: number;
  chapterCount: number;
  ideaCount: number;
  scriptCount: number;
  renderDoneCount: number;
};

type RecentVideo = {
  renderId: string;
  scriptId: string;
  bookId: string;
  bookTitle: string;
  ideaTitle: string;
  videoUrl: string;
  durationSec: number | null;
  completedAt: string | null;
};

export default async function HomePage() {
  const [books, renders, activeJobs] = await Promise.all([
    db.book.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { chapters: true } },
        chapters: {
          select: {
            _count: { select: { ideas: true } },
            ideas: {
              select: {
                script: {
                  select: {
                    id: true,
                    render: { select: { videoPath: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
    db.render.findMany({
      where: { videoPath: { not: null } },
      take: 6,
      orderBy: { completedAt: "desc" },
      include: {
        script: {
          include: {
            idea: {
              include: {
                chapter: { include: { book: { select: { id: true, title: true } } } },
              },
            },
          },
        },
      },
    }),
    db.job.count({ where: { status: { in: ["queued", "running"] } } }),
  ]);

  const summaries: BookSummary[] = books.map((b) => {
    let ideaCount = 0;
    let scriptCount = 0;
    let renderDoneCount = 0;
    for (const c of b.chapters) {
      ideaCount += c._count.ideas;
      for (const i of c.ideas) {
        if (i.script) scriptCount += 1;
        if (i.script?.render?.videoPath) renderDoneCount += 1;
      }
    }
    return {
      id: b.id,
      title: b.title,
      niche: b.niche,
      pageCount: b.pageCount,
      chapterCount: b._count.chapters,
      ideaCount,
      scriptCount,
      renderDoneCount,
    };
  });

  const recentVideos: RecentVideo[] = renders.map((r) => ({
    renderId: r.id,
    scriptId: r.scriptId,
    bookId: r.script.idea.chapter.book.id,
    bookTitle: r.script.idea.chapter.book.title,
    ideaTitle: r.script.idea.title,
    videoUrl: `/api/renders/${r.id}/video`,
    durationSec: r.durationSec,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
  }));

  return (
    <main className="max-w-6xl mx-auto p-8 space-y-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Library</h1>
          <p className="text-muted-foreground mt-1">
            {summaries.length === 0
              ? "No books yet. Upload one to start the pipeline."
              : `${summaries.length} book${summaries.length === 1 ? "" : "s"} · ${activeJobs} job${
                  activeJobs === 1 ? "" : "s"
                } running`}
          </p>
        </div>
        <Link href="/books/new">
          <Button>+ Upload book</Button>
        </Link>
      </header>

      {recentVideos.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Recent videos
            </h2>
            <Link href="/renders" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
              all videos →
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {recentVideos.map((v) => (
              <Card key={v.renderId} className="overflow-hidden">
                <video
                  src={v.videoUrl}
                  controls
                  preload="metadata"
                  className="w-full aspect-[9/16] bg-black object-contain"
                />
                <CardContent className="pt-3 space-y-1">
                  <div className="text-sm font-medium leading-snug line-clamp-2">{v.ideaTitle}</div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <Link href={`/books/${v.bookId}`} className="hover:underline truncate">
                      {v.bookTitle}
                    </Link>
                    <span>{v.durationSec ? `${v.durationSec.toFixed(1)}s` : ""}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Books</h2>
        {summaries.length === 0 ? (
          <Card>
            <CardContent className="py-12 flex flex-col items-center gap-4 text-center">
              <p className="text-muted-foreground">
                Drop a finance PDF and the pipeline will pull out chapters, score ideas, write scripts, and render videos.
              </p>
              <Link href="/books/new">
                <Button>+ Upload your first book</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {summaries.map((b) => (
              <BookCard key={b.id} book={b} />
            ))}
          </div>
        )}
      </section>

      <details className="rounded border border-border">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground select-none">
          System status & setup checks
        </summary>
        <div className="border-t border-border p-4">
          <SystemStatus />
        </div>
      </details>
    </main>
  );
}

function BookCard({ book }: { book: BookSummary }) {
  const totalSteps = 4; // chapters → ideas → scripts → renders
  const completed =
    (book.chapterCount > 0 ? 1 : 0) +
    (book.ideaCount > 0 ? 1 : 0) +
    (book.scriptCount > 0 ? 1 : 0) +
    (book.renderDoneCount > 0 ? 1 : 0);
  const pct = Math.round((completed / totalSteps) * 100);

  return (
    <Link href={`/books/${book.id}`} className="block group">
      <Card className="transition group-hover:border-primary/60 group-hover:bg-card/70 h-full">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="text-base leading-snug">{book.title}</CardTitle>
            <Badge variant="outline">{book.niche.replace("_", " ")}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-4 gap-2 text-xs">
            <Stat label="chapters" n={book.chapterCount} />
            <Stat label="ideas" n={book.ideaCount} />
            <Stat label="scripts" n={book.scriptCount} />
            <Stat label="videos" n={book.renderDoneCount} highlight={book.renderDoneCount > 0} />
          </div>
          <div className="space-y-1">
            <div className="h-1.5 rounded-full bg-card/40 overflow-hidden">
              <div
                className="h-full bg-primary/70 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="text-[10px] text-muted-foreground text-right">{pct}% through pipeline</div>
          </div>
          <div className="text-xs text-muted-foreground">{book.pageCount} pages</div>
        </CardContent>
      </Card>
    </Link>
  );
}

function Stat({ label, n, highlight }: { label: string; n: number; highlight?: boolean }) {
  return (
    <div className={`rounded border border-border px-2 py-1.5 text-center ${highlight ? "border-primary/60" : ""}`}>
      <div className={`text-base font-semibold leading-none ${highlight ? "text-primary" : ""}`}>{n}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}
