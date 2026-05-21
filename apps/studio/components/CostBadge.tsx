"use client";

import { useEffect, useState } from "react";

interface Summary {
  todayUsd: number;
  bookUsd: number;
  traceCount: number;
}

/**
 * Header chip that surfaces today's API spend (and per-book when scoped).
 * Polls /api/usage/summary every 30s — the backend caches for the same
 * interval so this stays cheap.
 */
export function CostBadge({ bookId }: { bookId?: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchOnce() {
      try {
        const url = bookId
          ? `/api/usage/summary?book=${encodeURIComponent(bookId)}`
          : "/api/usage/summary";
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status}`);
        const body = (await res.json()) as Summary;
        if (!cancelled) {
          setSummary(body);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }
    void fetchOnce();
    const id = setInterval(fetchOnce, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [bookId]);

  if (error) {
    return (
      <span className="text-xs text-red-300" title={`cost badge error: ${error}`}>
        cost ?
      </span>
    );
  }
  if (!summary) {
    return <span className="text-xs text-muted-foreground">cost …</span>;
  }

  const today = `$${summary.todayUsd.toFixed(2)} today`;
  const book = bookId ? ` · $${summary.bookUsd.toFixed(2)} this book` : "";
  return (
    <span className="text-xs px-2 py-1 rounded border bg-card/50">
      {today}
      {book}
    </span>
  );
}
