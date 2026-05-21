"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_SHORTCUTS, isEditableTarget, match } from "@/lib/shortcuts";

/**
 * Wraps the page tree. Listens for keydown events globally, dispatches
 * matching shortcut handlers, and ignores events whose target is an
 * editable element so typing in inputs never triggers shortcuts.
 *
 * Also renders the shortcuts cheatsheet `<dialog>` referenced by the `?`
 * shortcut.
 */
export function ShortcutsProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pendingRef = useRef<string | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isEditableTarget(e.target as Element | null)) return;
      // Ignore modified keys so cmd-r etc. still trigger their browser actions.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key;
      // Special case: '?' for the help modal — we always open the local dialog.
      if (key === "?") {
        e.preventDefault();
        setOpen(true);
        return;
      }
      const res = match(key, pendingRef.current, DEFAULT_SHORTCUTS);
      if (res.kind === "match") {
        e.preventDefault();
        pendingRef.current = null;
        if (pendingTimerRef.current) {
          clearTimeout(pendingTimerRef.current);
          pendingTimerRef.current = null;
        }
        res.shortcut.handler({ router: { push: router.push.bind(router) } });
      } else if (res.kind === "partial") {
        pendingRef.current = res.pendingPrefix;
        if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = setTimeout(() => {
          pendingRef.current = null;
        }, 800);
      } else {
        pendingRef.current = null;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    };
  }, [router]);

  return (
    <>
      {children}
      {open && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-card border rounded-lg p-6 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-3">Keyboard shortcuts</h2>
            <ul className="space-y-2 text-sm">
              {DEFAULT_SHORTCUTS.map((s) => (
                <li key={s.keys} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{s.description}</span>
                  <kbd className="font-mono text-xs px-2 py-0.5 rounded border">{s.keys}</kbd>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="mt-4 text-xs text-muted-foreground"
              onClick={() => setOpen(false)}
            >
              Press Esc or click outside to close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
