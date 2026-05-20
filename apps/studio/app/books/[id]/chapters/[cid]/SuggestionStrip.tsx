"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type SuggestionRow = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  reason: string;
  affectedTitles: string[];
};

const KIND_VARIANT: Record<string, "success" | "warn" | "error" | "default" | "outline"> = {
  merge: "success",
  split: "warn",
  drop: "error",
  series: "default",
  reframe: "outline",
};

export function SuggestionStrip({ suggestions }: { suggestions: SuggestionRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  if (suggestions.length === 0) return null;
  const visible = suggestions.filter((s) => !hidden.has(s.id));
  if (visible.length === 0) return null;

  async function act(id: string, action: "accept" | "dismiss") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/suggestions/${id}/${action}`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Could not ${action}: ${data.error ?? res.statusText}`);
        if (res.status === 409) router.refresh();
        return;
      }
      setHidden((prev) => new Set(prev).add(id));
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">
        Suggestions ({visible.length})
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {visible.map((s) => (
          <div
            key={s.id}
            className="min-w-[280px] max-w-[320px] shrink-0 rounded-lg border border-border bg-card p-3 space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <Badge variant={KIND_VARIANT[s.kind] ?? "outline"}>{s.kind}</Badge>
            </div>
            {s.affectedTitles.length > 0 && (
              <ul className="text-xs space-y-0.5">
                {s.affectedTitles.map((t, i) => (
                  <li key={i} className="text-foreground/90 truncate">• {t}</li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground line-clamp-3">{s.reason}</p>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                onClick={() => act(s.id, "accept")}
                disabled={busyId === s.id}
              >
                Accept
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => act(s.id, "dismiss")}
                disabled={busyId === s.id}
              >
                Dismiss
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
