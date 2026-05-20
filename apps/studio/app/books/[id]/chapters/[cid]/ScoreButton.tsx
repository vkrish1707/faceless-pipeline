"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type JobInfo = { jobId: string; status: string; progress: number; error: string | null };

export function ScoreButton({
  chapterId,
  ideaCount,
  hasScores,
}: {
  chapterId: string;
  ideaCount: number;
  hasScores: boolean;
}) {
  const router = useRouter();
  const [job, setJob] = useState<JobInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const refreshedRef = useRef(false);

  const active = job?.status === "queued" || job?.status === "running";

  useEffect(() => {
    if (!active || !job) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled || document.hidden) return;
      try {
        const res = await fetch(`/api/jobs/${job.jobId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setJob({ jobId: data.id, status: data.status, progress: data.progress, error: data.error });
        if ((data.status === "completed" || data.status === "failed") && !refreshedRef.current) {
          refreshedRef.current = true;
          router.refresh();
        }
      } catch {
        /* transient, next tick retries */
      }
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
  }, [active, job, router]);

  async function trigger() {
    setBusy(true);
    refreshedRef.current = false;
    try {
      const res = await fetch(`/api/chapters/${chapterId}/score`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(`Could not start scoring: ${data.error ?? res.statusText}`);
        return;
      }
      setJob({ jobId: data.jobId, status: "queued", progress: 0, error: null });
    } finally {
      setBusy(false);
    }
  }

  const disabled = ideaCount === 0 || busy || active;
  const label = hasScores ? "Re-score" : "Score & suggest";

  return (
    <div className="flex items-center gap-2">
      {job && job.status === "failed" && (
        <Badge variant="error" title={job.error ?? ""}>scoring failed</Badge>
      )}
      {active && (
        <Badge variant="warn">
          {job!.status} {job!.progress}%
        </Badge>
      )}
      <Button size="sm" onClick={trigger} disabled={disabled} title={ideaCount === 0 ? "Extract ideas first" : ""}>
        {label}
      </Button>
    </div>
  );
}
