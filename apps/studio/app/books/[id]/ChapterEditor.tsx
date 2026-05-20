"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SplitModal } from "./SplitModal";

type ChapterRow = {
  id: string;
  title: string;
  orderIndex: number;
  startPage: number;
  endPage: number;
  wordCount: number;
  status: string;
  ideaCount: number;
  rawText: string;
};

type JobInfo = { jobId: string; status: string; progress: number; error: string | null };

export function ChapterEditor({ bookId, initialChapters }: { bookId: string; initialChapters: ChapterRow[] }) {
  const router = useRouter();
  const [chapters, setChapters] = useState(initialChapters);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [splittingId, setSplittingId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<string, JobInfo>>({}); // chapterId -> latest job
  const cancelEditRef = useRef(false);

  // Refresh state from server (after mutations).
  const refresh = useCallback(() => router.refresh(), [router]);

  // Poll active jobs. Pause when the tab is hidden; resume on visibility change.
  useEffect(() => {
    const activeEntries = Object.entries(jobs).filter(
      ([, j]) => j.status === "queued" || j.status === "running"
    );
    if (activeEntries.length === 0) return;

    let cancelled = false;
    const tick = async () => {
      if (cancelled || document.hidden) return;
      const updates: Record<string, JobInfo> = {};
      let anyTerminal = false;
      for (const [chapterId, j] of activeEntries) {
        try {
          const res = await fetch(`/api/jobs/${j.jobId}`, { cache: "no-store" });
          if (!res.ok) continue;
          const data = await res.json();
          updates[chapterId] = {
            jobId: data.id,
            status: data.status,
            progress: data.progress,
            error: data.error,
          };
          if (data.status === "completed" || data.status === "failed") {
            anyTerminal = true;
          }
        } catch {
          // transient errors are non-fatal; next tick will retry
        }
      }
      if (cancelled) return;
      if (Object.keys(updates).length > 0) {
        setJobs((prev) => ({ ...prev, ...updates }));
      }
      if (anyTerminal) refresh();
    };

    const interval = setInterval(tick, 2000);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [jobs, refresh]);

  async function startEdit(c: ChapterRow) {
    setEditingId(c.id);
    setEditValue(c.title);
  }

  async function saveTitle(c: ChapterRow) {
    if (cancelEditRef.current) {
      cancelEditRef.current = false;
      setEditingId(null);
      return;
    }
    if (editValue.trim() && editValue !== c.title) {
      await fetch(`/api/chapters/${c.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: editValue.trim() }),
      });
      setChapters((cs) => cs.map((x) => (x.id === c.id ? { ...x, title: editValue.trim() } : x)));
    }
    setEditingId(null);
  }

  async function deleteChapter(c: ChapterRow) {
    if (!confirm(`Delete chapter "${c.title}"? This also deletes its ideas.`)) return;
    await fetch(`/api/chapters/${c.id}`, { method: "DELETE" });
    setChapters((cs) => cs.filter((x) => x.id !== c.id).map((x, i) => ({ ...x, orderIndex: i })));
    refresh();
  }

  async function mergeWithNext(c: ChapterRow) {
    if (!confirm(`Merge "${c.title}" with the next chapter? Ideas on the next chapter will be deleted.`)) return;
    await fetch(`/api/chapters/${c.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mergeWithNext: true }),
    });
    refresh();
  }

  async function extract(c: ChapterRow) {
    const res = await fetch(`/api/chapters/${c.id}/extract`, { method: "POST" });
    const data = await res.json();
    setJobs((j) => ({ ...j, [c.id]: { jobId: data.jobId, status: "queued", progress: 0, error: null } }));
  }

  async function extractAll() {
    const pending = chapters.filter((c) => c.ideaCount === 0);
    for (const c of pending) {
      // sequential enqueue to avoid hammering the API; jobs themselves run concurrently in-process
      await extract(c);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Chapters</CardTitle>
          <Button size="sm" onClick={extractAll}>Extract all</Button>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {chapters.map((c, i) => {
              const job = jobs[c.id];
              return (
                <li key={c.id} className="flex items-start justify-between border-b border-border py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground text-sm w-6">{i + 1}.</span>
                      {editingId === c.id ? (
                        <input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => saveTitle(c)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveTitle(c);
                            if (e.key === "Escape") {
                              cancelEditRef.current = true;
                              setEditingId(null);
                            }
                          }}
                          className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
                        />
                      ) : (
                        <button onClick={() => startEdit(c)} className="font-medium text-left hover:underline">
                          {c.title}
                        </button>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 ml-9">
                      pp. {c.startPage + 1}–{c.endPage + 1} · {c.wordCount.toLocaleString()} words
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    {c.ideaCount > 0 ? (
                      <Link href={`/books/${bookId}/chapters/${c.id}`}>
                        <Badge variant="success">{c.ideaCount} ideas</Badge>
                      </Link>
                    ) : job ? (
                      job.status === "failed" ? (
                        <Badge variant="error" title={job.error ?? ""}>failed</Badge>
                      ) : (
                        <Badge variant="warn">{job.status} {job.progress}%</Badge>
                      )
                    ) : (
                      <Badge variant="outline">pending</Badge>
                    )}
                    <Button size="sm" variant="outline" onClick={() => extract(c)} disabled={job?.status === "running" || job?.status === "queued"}>
                      {c.ideaCount > 0 ? "Re-extract" : "Extract ideas"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSplittingId(c.id)}>Split</Button>
                    {i < chapters.length - 1 && (
                      <Button size="sm" variant="ghost" onClick={() => mergeWithNext(c)}>Merge↓</Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => deleteChapter(c)}>Delete</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {splittingId && (
        <SplitModal
          chapter={chapters.find((c) => c.id === splittingId)!}
          onClose={() => setSplittingId(null)}
          onSplit={() => {
            setSplittingId(null);
            refresh();
          }}
        />
      )}
    </>
  );
}
