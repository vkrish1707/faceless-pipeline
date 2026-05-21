"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function BulkActions({ scriptId }: { scriptId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function fetchAll(refresh: boolean) {
    setBusy(true);
    setStatus(refresh ? "Re-fetching…" : "Fetching…");
    try {
      const url = refresh
        ? `/api/scripts/${scriptId}/broll/fetch?refresh=1`
        : `/api/scripts/${scriptId}/broll/fetch`;
      const res = await fetch(url, { method: "POST" });
      if (res.status === 409) {
        setStatus("Already running");
      } else if (!res.ok) {
        throw new Error(await res.text());
      } else {
        const { jobId } = (await res.json()) as { jobId: string };
        await pollJob(jobId, setStatus);
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function autoPick() {
    setBusy(true);
    setStatus("Auto-picking…");
    try {
      const res = await fetch(`/api/scripts/${scriptId}/broll/auto-pick`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { picked: number };
      setStatus(`Auto-picked ${data.picked} beat${data.picked === 1 ? "" : "s"}`);
      startTransition(() => router.refresh());
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || pending;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <Button onClick={() => fetchAll(false)} disabled={disabled}>
          Fetch all
        </Button>
        <Button variant="outline" onClick={autoPick} disabled={disabled}>
          Auto-pick top
        </Button>
        <Button variant="outline" onClick={() => fetchAll(true)} disabled={disabled}>
          Re-fetch all
        </Button>
      </div>
      {status && <p className="text-xs text-muted-foreground">{status}</p>}
    </div>
  );
}

async function pollJob(jobId: string, setStatus: (s: string) => void): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) {
      setStatus(`job failed: ${await res.text()}`);
      return;
    }
    const data = (await res.json()) as { status: string; progress: number; error?: string };
    setStatus(`${data.status} · ${data.progress}%`);
    if (data.status === "completed") return;
    if (data.status === "failed") throw new Error(data.error ?? "job failed");
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error("timed out polling job");
}
