import Link from "next/link";
import { db } from "@/lib/db";
import { SystemStatus } from "@/components/system-status";
import { PipelineGuide, type PipelineCounts } from "@/components/PipelineGuide";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [books, activeJobs, counts] = await Promise.all([
    db.book.findMany({
      orderBy: { createdAt: "desc" },
      take: 4,
      include: {
        _count: { select: { chapters: true } },
        chapters: { select: { _count: { select: { ideas: true } } } },
      },
    }),
    db.job.count({ where: { status: { in: ["queued", "running"] } } }),
    Promise.all([
      db.book.count(),
      db.idea.count(),
      db.script.count(),
      db.render.count({ where: { audioPath: { not: null } } }),
      // brollPicked = scripts whose every beat has pickedAssetId; coarse-approximate by counting
      // Asset rows marked pickedAt (we don't have a denormalized counter, so just count picked assets).
      db.asset.count({ where: { pickedAt: { not: null } } }),
      db.render.count({ where: { videoPath: { not: null } } }),
    ]),
  ]);

  const pipelineCounts: PipelineCounts = {
    books: counts[0],
    ideas: counts[1],
    scripts: counts[2],
    audios: counts[3],
    brollPicked: counts[4],
    renders: counts[5],
  };

  return (
    <main className="max-w-5xl mx-auto p-8 space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Faceless Pipeline</h1>
        <p className="text-muted-foreground">PDF → scored ideas → scripts → audio → b-roll → render.</p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link href="/books/new" className="group">
          <Card className="transition group-hover:border-primary/60 h-full">
            <CardContent className="pt-6 space-y-1">
              <div className="text-lg font-semibold">+ Upload a book</div>
              <p className="text-xs text-muted-foreground">Drop a finance PDF to start the pipeline.</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/books" className="group">
          <Card className="transition group-hover:border-primary/60 h-full">
            <CardContent className="pt-6 space-y-1">
              <div className="text-lg font-semibold">Books</div>
              <p className="text-xs text-muted-foreground">
                {books.length === 0 ? "No books yet" : `${pipelineCounts.books} total · ${books.length} shown below`}
              </p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/renders" className="group">
          <Card className="transition group-hover:border-primary/60 h-full">
            <CardContent className="pt-6 space-y-1">
              <div className="text-lg font-semibold">Render queue</div>
              <p className="text-xs text-muted-foreground">
                {activeJobs === 0
                  ? `${pipelineCounts.renders} done · nothing running`
                  : `${activeJobs} job${activeJobs === 1 ? "" : "s"} in flight`}
              </p>
            </CardContent>
          </Card>
        </Link>
      </section>

      <PipelineGuide counts={pipelineCounts} />

      {books.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Recent books</h2>
            <Link href="/books" className="text-xs text-muted-foreground hover:text-foreground hover:underline">view all →</Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {books.map((b) => {
              const ideaCount = b.chapters.reduce((s, c) => s + c._count.ideas, 0);
              return (
                <Link key={b.id} href={`/books/${b.id}`} className="block group">
                  <Card className="transition group-hover:border-primary/60">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <CardTitle className="text-base leading-snug">{b.title}</CardTitle>
                        <Badge variant="outline">{b.niche.replace("_", " ")}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{b.pageCount}p</span>
                        <span>·</span>
                        <span>{b._count.chapters} chapters</span>
                        <span>·</span>
                        <span>{ideaCount} ideas</span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <SystemStatus />
    </main>
  );
}
