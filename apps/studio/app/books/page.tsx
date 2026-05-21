import Link from "next/link";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function BooksIndexPage() {
  const books = await db.book.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { chapters: true } },
      chapters: {
        select: { _count: { select: { ideas: true } } },
      },
    },
  });

  return (
    <main className="max-w-5xl mx-auto p-8 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Books</h1>
          <p className="text-muted-foreground mt-1">
            {books.length === 0
              ? "No books yet. Upload your first PDF to get started."
              : `${books.length} book${books.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <Link href="/books/new">
          <Button>+ Upload book</Button>
        </Link>
      </header>

      {books.length === 0 ? (
        <Card>
          <CardContent className="py-12 flex flex-col items-center gap-4 text-center">
            <p className="text-muted-foreground">Drop a finance PDF in to extract chapters, ideas, scripts, and renders.</p>
            <Link href="/books/new">
              <Button>+ Upload your first book</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {books.map((b) => {
            const ideaCount = b.chapters.reduce((s, c) => s + c._count.ideas, 0);
            return (
              <Link key={b.id} href={`/books/${b.id}`} className="block group">
                <Card className="transition group-hover:border-primary/60 group-hover:bg-card/70">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="text-base leading-snug">{b.title}</CardTitle>
                      <Badge variant="outline">{b.niche.replace("_", " ")}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{b.pageCount} pages</span>
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
      )}
    </main>
  );
}
