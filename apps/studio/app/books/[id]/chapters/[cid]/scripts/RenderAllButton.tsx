"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface RenderAllButtonProps {
  chapterId: string;
  readyCount: number;
}

/**
 * Header CTA that fires POST /api/renders/bulk for the current chapter.
 * The shortcut handler in lib/shortcuts.ts clicks `#render-all` so the
 * `r` keystroke works on the scripts page.
 */
export function RenderAllButton({ chapterId, readyCount }: RenderAllButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (busy || readyCount === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/renders/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `failed (${res.status})`);
        return;
      }
      router.push(`/renders?chapter=${encodeURIComponent(chapterId)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        id="render-all"
        type="button"
        onClick={onClick}
        disabled={busy || readyCount === 0}
        className="text-sm px-3 py-1.5 rounded border bg-card hover:bg-muted/30 disabled:opacity-50"
        title={readyCount === 0 ? "No scripts ready — synthesize audio + pick all b-roll first" : ""}
      >
        {busy ? "Queuing…" : `Render All (${readyCount} ready)`}
      </button>
      {error && <span className="text-xs text-red-300">{error}</span>}
    </div>
  );
}
