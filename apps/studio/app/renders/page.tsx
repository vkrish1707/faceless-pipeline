import path from "node:path";
import { db } from "@/lib/db";
import { RendersDashboard, type RenderRow } from "./RendersDashboard";

export const dynamic = "force-dynamic";

export default async function RendersPage({
  searchParams,
}: {
  searchParams: Promise<{ chapter?: string }>;
}) {
  const { chapter } = await searchParams;

  const renders = await db.render.findMany({
    where: chapter
      ? { script: { idea: { chapterId: chapter } } }
      : undefined,
    include: {
      script: {
        include: {
          idea: {
            include: { chapter: { select: { id: true, title: true } } },
          },
        },
      },
    },
    orderBy: [{ startedAt: "desc" }],
  });

  const initial: RenderRow[] = renders.map((r) => ({
    id: r.id,
    scriptId: r.scriptId,
    scriptTitle: r.script.idea.title,
    chapterId: r.script.idea.chapter.id,
    chapterTitle: r.script.idea.chapter.title,
    status: r.status,
    progress: r.progress,
    durationSec: r.durationSec,
    fileSizeMB: r.fileSizeMB,
    error: r.error,
    warning: r.warning,
    videoUrl: r.videoPath ? `/api/renders/${r.id}/video` : null,
    bundleDir: r.videoPath ? path.dirname(r.videoPath) : null,
    musicPath: r.musicPath,
    startedAt: r.startedAt ? r.startedAt.toISOString() : null,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
  }));

  return (
    <main className="max-w-6xl mx-auto p-8">
      <RendersDashboard initial={initial} chapterId={chapter ?? null} />
    </main>
  );
}
