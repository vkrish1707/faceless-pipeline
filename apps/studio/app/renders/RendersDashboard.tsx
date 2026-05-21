"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface RenderRow {
  id: string;
  scriptId: string;
  scriptTitle: string;
  chapterId: string;
  chapterTitle: string;
  status: string;
  progress: number;
  durationSec: number | null;
  fileSizeMB: number | null;
  error: string | null;
  warning: string | null;
  videoUrl: string | null;
  bundleDir: string | null;
  musicPath: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

const IN_FLIGHT = new Set(["voice", "captions", "render", "bundle", "running"]);

function stageLabel(status: string): string {
  if (IN_FLIGHT.has(status)) return status;
  return status;
}

function sortRows(rows: RenderRow[]): RenderRow[] {
  return [...rows].sort((a, b) => {
    const cat = (r: RenderRow) => {
      if (IN_FLIGHT.has(r.status)) return 0;
      if (r.status === "queued") return 1;
      if (r.status === "done") return 2;
      if (r.status === "failed") return 3;
      return 4;
    };
    const ca = cat(a);
    const cb = cat(b);
    if (ca !== cb) return ca - cb;
    const ta = a.startedAt ? Date.parse(a.startedAt) : 0;
    const tb = b.startedAt ? Date.parse(b.startedAt) : 0;
    return tb - ta;
  });
}

function formatElapsed(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return "—";
  const start = Date.parse(startedAt);
  const end = completedAt ? Date.parse(completedAt) : Date.now();
  const sec = Math.max(0, Math.floor((end - start) / 1000));
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

interface DashboardProps {
  initial: RenderRow[];
  chapterId: string | null;
}

export function RendersDashboard({ initial, chapterId }: DashboardProps) {
  const [rows, setRows] = useState<RenderRow[]>(initial);
  const [wsState, setWsState] = useState<"connecting" | "open" | "polling">("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [toast, setToast] = useState<{ id: string; text: string } | null>(null);

  const refetch = useCallback(async () => {
    try {
      const url = chapterId ? `/api/renders?chapter=${encodeURIComponent(chapterId)}` : "/api/renders";
      const res = await fetch(url);
      if (!res.ok) return;
      const body = (await res.json()) as { rows: RenderRow[] };
      setRows(body.rows);
    } catch {
      // ignore — keep prior rows on transient failures
    }
  }, [chapterId]);

  // Apply incremental WS update events to the local rows array.
  const applyEvent = useCallback(
    (ev: unknown) => {
      const e = ev as { type?: string };
      if (!e || typeof e.type !== "string") return;
      if (e.type === "render.update") {
        const u = ev as {
          renderId: string;
          status: string;
          progress: number;
          videoPath?: string;
        };
        setRows((prev) => {
          const idx = prev.findIndex((r) => r.id === u.renderId);
          if (idx < 0) {
            // Backfill the row asynchronously — typically only fires when a
            // new render arrives while we're on the page.
            void fetch(`/api/renders/${u.renderId}/state`)
              .then((r) => (r.ok ? r.json() : null))
              .then((row) => {
                if (row && typeof row === "object" && (row as RenderRow).id) {
                  setRows((curr) => [row as RenderRow, ...curr]);
                }
              })
              .catch(() => undefined);
            return prev;
          }
          const next = prev.slice();
          next[idx] = {
            ...next[idx]!,
            status: u.status,
            progress: u.progress,
            videoUrl: u.videoPath ? `/api/renders/${u.renderId}/video` : next[idx]!.videoUrl,
          };
          if (u.status === "done" && next[idx]!.status !== "done") {
            // Toast on completion if user is on a non-/renders page.
            if (typeof window !== "undefined" && !window.location.pathname.startsWith("/renders")) {
              setToast({ id: u.renderId, text: `Render done: ${next[idx]!.scriptTitle}` });
            }
          }
          return next;
        });
      } else if (e.type === "job.update") {
        // job.update for a render_script handler — we mostly rely on
        // render.update for status, but progress propagation is useful.
        const u = ev as { targetType?: string; targetId?: string; progress?: number };
        if (u.targetType === "Render" && u.targetId && typeof u.progress === "number") {
          setRows((prev) => {
            const idx = prev.findIndex((r) => r.id === u.targetId);
            if (idx < 0) return prev;
            const next = prev.slice();
            next[idx] = { ...next[idx]!, progress: u.progress! };
            return next;
          });
        }
      }
    },
    []
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    function connect() {
      try {
        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(`${proto}//${window.location.host}/api/ws`);
        wsRef.current = ws;
        ws.onopen = () => {
          if (cancelled) return;
          setWsState("open");
          // Subscribe to the chapter scope or global.
          ws.send(
            JSON.stringify({
              type: "subscribe",
              scopes: [chapterId ? `chapter:${chapterId}` : "global"],
            })
          );
          // Stop polling if we were doing it.
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
          // On reconnect, refresh state so we don't drift.
          void refetch();
        };
        ws.onmessage = (msg) => {
          if (cancelled) return;
          try {
            applyEvent(JSON.parse(msg.data));
          } catch {
            // ignore
          }
        };
        ws.onclose = () => {
          if (cancelled) return;
          setWsState("polling");
          if (!pollTimerRef.current) {
            pollTimerRef.current = setInterval(() => void refetch(), 2000);
          }
          // Try reconnect after 2s.
          setTimeout(connect, 2000);
        };
        ws.onerror = () => {
          try {
            ws.close();
          } catch {
            // ignore
          }
        };
      } catch {
        setWsState("polling");
        if (!pollTimerRef.current) {
          pollTimerRef.current = setInterval(() => void refetch(), 2000);
        }
      }
    }

    connect();
    return () => {
      cancelled = true;
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
      }
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [applyEvent, chapterId, refetch]);

  const sorted = useMemo(() => sortRows(rows), [rows]);
  const counts = useMemo(() => {
    let rendering = 0;
    let queued = 0;
    let done = 0;
    let failed = 0;
    for (const r of rows) {
      if (IN_FLIGHT.has(r.status)) rendering += 1;
      else if (r.status === "queued") queued += 1;
      else if (r.status === "done") done += 1;
      else if (r.status === "failed") failed += 1;
    }
    return { rendering, queued, done, failed };
  }, [rows]);

  async function onRetry(id: string) {
    const res = await fetch(`/api/renders/${id}/retry`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(`Retry failed: ${(body as { error?: string }).error ?? res.status}`);
      return;
    }
    void refetch();
  }

  async function onReveal(id: string) {
    await fetch(`/api/renders/${id}/reveal`, { method: "POST" });
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Renders</h1>
        <div className="text-sm text-muted-foreground">
          {counts.rendering} rendering · {counts.queued} queued · {counts.done} done · {counts.failed} failed
          {wsState === "polling" ? " · polling" : ""}
        </div>
      </header>

      {sorted.length === 0 && (
        <p className="text-sm text-muted-foreground">No renders yet.</p>
      )}

      <ul className="divide-y border rounded">
        {sorted.map((r) => (
          <li key={r.id} className="p-4 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{r.scriptTitle}</p>
              <p className="text-xs text-muted-foreground">
                {r.chapterTitle} · stage {stageLabel(r.status)} · {formatElapsed(r.startedAt, r.completedAt)}
                {r.warning ? ` · ${r.warning}` : ""}
                {r.error ? ` · ${r.error.slice(0, 100)}` : ""}
              </p>
              <div className="mt-1 h-1.5 rounded bg-muted/30 overflow-hidden">
                <div
                  className={`h-full ${
                    r.status === "failed"
                      ? "bg-red-500"
                      : r.status === "done"
                      ? "bg-green-500"
                      : "bg-primary"
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, r.progress))}%` }}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              {r.status === "failed" && (
                <button
                  type="button"
                  className="text-xs px-2 py-1 rounded border hover:bg-muted/30"
                  onClick={() => onRetry(r.id)}
                >
                  Retry
                </button>
              )}
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border hover:bg-muted/30"
                data-shortcut="open-folder"
                onClick={() => onReveal(r.id)}
                disabled={!r.bundleDir}
                title={r.bundleDir ?? "no bundle yet"}
              >
                Open folder
              </button>
              {r.videoUrl && (
                <a
                  href={r.videoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs px-2 py-1 rounded border hover:bg-muted/30"
                >
                  Play
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>

      {toast && (
        <div
          className="fixed bottom-4 right-4 bg-card border rounded shadow-lg p-3 text-sm flex items-center gap-3"
          role="status"
          aria-live="polite"
        >
          <span>{toast.text}</span>
          <button
            type="button"
            className="text-xs underline"
            onClick={() => setToast(null)}
          >
            dismiss
          </button>
        </div>
      )}
    </div>
  );
}
