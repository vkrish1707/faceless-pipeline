"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type ChapterLike = { id: string; title: string; rawText: string };

export function SplitModal({ chapter, onClose, onSplit }: { chapter: ChapterLike; onClose: () => void; onSplit: () => void }) {
  const [atOffset, setAtOffset] = useState<number | null>(null);
  const [newTitle, setNewTitle] = useState("New chapter");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Break the chapter text into paragraphs; clicking between them sets atOffset.
  const paragraphs: { text: string; endOffset: number }[] = [];
  let runningOffset = 0;
  for (const para of chapter.rawText.split(/\n\s*\n/)) {
    runningOffset += para.length + 2;
    paragraphs.push({ text: para, endOffset: runningOffset });
  }

  async function submit() {
    if (atOffset === null) {
      setError("Click between two paragraphs to choose a split point.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/chapters/${chapter.id}/split`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ atOffset, newTitle: newTitle.trim() || "New chapter" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "split failed");
      }
      onSplit();
    } catch (e) {
      setError(e instanceof Error ? e.message : "split failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-lg max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold">Split &quot;{chapter.title}&quot;</h2>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>
        <div className="p-4 overflow-y-auto space-y-1 flex-1">
          {paragraphs.map((p, i) => (
            <div key={i}>
              <div className="text-sm whitespace-pre-wrap">{p.text}</div>
              {i < paragraphs.length - 1 && (
                <button
                  onClick={() => setAtOffset(p.endOffset)}
                  className={`block w-full my-2 py-1 text-xs rounded border ${
                    atOffset === p.endOffset
                      ? "border-primary bg-primary/20 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  {atOffset === p.endOffset ? "↑ split here ↓" : "split here"}
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-border space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">New chapter title</label>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          {error && <div className="text-sm text-red-300">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={submitting || atOffset === null}>
              {submitting ? "Splitting..." : "Split"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
