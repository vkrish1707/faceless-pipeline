"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IdeaCard } from "./IdeaCard";

type Breakdown = {
  hook_strength: number;
  specificity: number;
  trend_alignment: number;
  format_fit: number;
  shelf_life: number;
};

export type IdeaRow = {
  id: string;
  title: string;
  summary: string;
  targetLengthSec: number;
  sourceQuotes: string[];
  candidateHooks: string[];
  score: number | null;
  breakdown: Breakdown | null;
  trendsPartial: boolean;
  status: string;
};

type JobInfo = { jobId: string; status: string; progress: number };

export function IdeaGrid({
  bookId,
  chapterId,
  ideas,
  hasScores,
}: {
  bookId: string;
  chapterId: string;
  ideas: IdeaRow[];
  hasScores: boolean;
}) {
  const router = useRouter();
  const initialApproved = useMemo(
    () => new Set(ideas.filter((i) => i.status === "approved" || i.status === "scripted").map((i) => i.id)),
    [ideas]
  );
  const [approved, setApproved] = useState<Set<string>>(initialApproved);
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const approvable = hasScores;
  const activeJobs = jobs.filter((j) => j.status === "queued" || j.status === "running");

  useEffect(() => {
    if (activeJobs.length === 0) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || document.hidden) return;
      const next: JobInfo[] = [];
      let anyTerminal = false;
      for (const j of activeJobs) {
        try {
          const res = await fetch(`/api/jobs/${j.jobId}`, { cache: "no-store" });
          if (!res.ok) {
            next.push(j);
            continue;
          }
          const data = await res.json();
          next.push({ jobId: data.id, status: data.status, progress: data.progress });
          if (data.status === "completed" || data.status === "failed") anyTerminal = true;
        } catch {
          next.push(j);
        }
      }
      if (cancelled) return;
      setJobs((prev) => prev.map((p) => next.find((n) => n.jobId === p.jobId) ?? p));
      if (anyTerminal) router.refresh();
    };
    const interval = setInterval(tick, 2000);
    const onVis = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [activeJobs, router]);

  async function persistApproved(next: Set<string>) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await fetch(`/api/chapters/${chapterId}/approve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ideaIds: Array.from(next) }),
        });
      } catch {
        /* optimistic; ignore */
      }
    }, 300);
  }

  function toggle(id: string) {
    setApproved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persistApproved(next);
      return next;
    });
  }

  async function generate() {
    if (approved.size === 0) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/chapters/${chapterId}/generate-scripts`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(`Could not start generation: ${data.error ?? res.statusText}`);
        return;
      }
      const jobIds: string[] = data.jobIds ?? [];
      setJobs(jobIds.map((id) => ({ jobId: id, status: "queued", progress: 0 })));
      router.push(`/books/${bookId}/chapters/${chapterId}/scripts?group=${data.groupId}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {approvable && (
        <div className="flex items-center gap-3">
          {activeJobs.length > 0 && (
            <Badge variant="warn">
              generating {activeJobs.length} script{activeJobs.length === 1 ? "" : "s"}…
            </Badge>
          )}
          <Button
            onClick={generate}
            disabled={approved.size === 0 || busy || activeJobs.length > 0}
          >
            Generate scripts ({approved.size} selected)
          </Button>
        </div>
      )}

      {ideas.length === 0 ? (
        <p className="text-muted-foreground">No ideas yet. Click &quot;Extract ideas&quot; on the chapter list.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ideas.map((idea) => (
            <IdeaCard
              key={idea.id}
              title={idea.title}
              summary={idea.summary}
              targetLengthSec={idea.targetLengthSec}
              sourceQuotes={idea.sourceQuotes}
              candidateHooks={idea.candidateHooks}
              score={idea.score}
              breakdown={idea.breakdown}
              trendsPartial={idea.trendsPartial}
              approvable={approvable}
              approved={approved.has(idea.id)}
              onToggleApprove={() => toggle(idea.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
