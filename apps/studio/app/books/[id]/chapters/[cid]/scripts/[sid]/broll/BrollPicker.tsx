"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AssetCandidate = {
  id: string;
  type: string;
  thumbUrl: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  sourceUrl: string | null;
};

export type BeatRow = {
  beatIndex: number;
  start: number;
  end: number;
  keywords: string[];
  mediaType: "photo" | "video";
  tone: string;
  pickedAssetId: string | null;
  candidates: AssetCandidate[];
};

export function BrollPicker({ scriptId, rows }: { scriptId: string; rows: BeatRow[] }) {
  return (
    <ol className="space-y-6">
      {rows.map((row) => (
        <BeatRowView key={row.beatIndex} scriptId={scriptId} row={row} />
      ))}
    </ol>
  );
}

function BeatRowView({ scriptId, row }: { scriptId: string; row: BeatRow }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draftKeywords, setDraftKeywords] = useState(row.keywords.join(", "));
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function pick(assetId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/scripts/${scriptId}/beats/${row.beatIndex}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pickedAssetId: assetId }),
      });
      if (!res.ok) throw new Error(`pick failed: ${await res.text()}`);
      startTransition(() => router.refresh());
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function clearPick() {
    setBusy(true);
    try {
      const res = await fetch(`/api/scripts/${scriptId}/beats/${row.beatIndex}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pickedAssetId: null }),
      });
      if (!res.ok) throw new Error(`clear failed: ${await res.text()}`);
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  async function saveKeywords() {
    const kw = draftKeywords
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 5);
    if (kw.length === 0) {
      alert("at least one keyword required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/scripts/${scriptId}/beats/${row.beatIndex}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords: kw }),
      });
      if (!res.ok) throw new Error(`save failed: ${await res.text()}`);
      // Re-fetch this beat by re-running the full fetch job (cheap if cached).
      const job = await fetch(`/api/scripts/${scriptId}/broll/fetch?refresh=1`, { method: "POST" });
      if (!job.ok && job.status !== 409) throw new Error(`refetch failed: ${await job.text()}`);
      setEditing(false);
      startTransition(() => router.refresh());
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function uploadFile(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("beatIndex", String(row.beatIndex));
      form.set("file", file);
      const res = await fetch(`/api/scripts/${scriptId}/broll/upload`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(`upload failed: ${await res.text()}`);
      startTransition(() => router.refresh());
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) void uploadFile(file);
  }

  const disabled = busy || pending;

  return (
    <li>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">
              Beat {row.beatIndex + 1} · {row.start}–{row.end}s
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">{row.mediaType}</Badge>
              {row.tone && <Badge variant="outline">{row.tone}</Badge>}
              {!editing ? (
                <span>
                  keywords:{" "}
                  <button
                    onClick={() => setEditing(true)}
                    className="text-foreground hover:underline"
                  >
                    {row.keywords.join(", ") || "(empty)"}
                  </button>
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <input
                    type="text"
                    value={draftKeywords}
                    onChange={(e) => setDraftKeywords(e.target.value)}
                    className="bg-background border rounded px-2 py-1 text-foreground text-xs w-72"
                    placeholder="comma-separated keywords"
                    aria-label={`keywords for beat ${row.beatIndex + 1}`}
                  />
                  <Button size="sm" onClick={saveKeywords} disabled={disabled}>
                    save & re-fetch
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setDraftKeywords(row.keywords.join(", "));
                      setEditing(false);
                    }}
                    disabled={disabled}
                  >
                    cancel
                  </Button>
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <input
              type="file"
              ref={fileInput}
              accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadFile(f);
              }}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInput.current?.click()}
              disabled={disabled}
            >
              upload manual
            </Button>
            {row.pickedAssetId && (
              <Button size="sm" variant="ghost" onClick={clearPick} disabled={disabled}>
                clear pick
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="space-y-3"
        >
          {row.candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No candidates yet. Click <strong>Fetch all</strong> in the header, or drag/drop a
              local image or video here.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {row.candidates.map((c) => {
                const isPicked = c.id === row.pickedAssetId;
                return (
                  <div
                    key={c.id}
                    className={cn(
                      "relative rounded-md border overflow-hidden bg-muted aspect-[9/16]",
                      isPicked && "ring-4 ring-primary"
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={c.thumbUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between p-1.5 bg-black/60">
                      <span className="text-[10px] text-white/80 uppercase">
                        {c.type.replace("pexels_", "")}
                      </span>
                      <button
                        onClick={() => pick(c.id)}
                        disabled={disabled || isPicked}
                        className="text-[11px] px-2 py-0.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        {isPicked ? "✓ picked" : "pick"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </li>
  );
}
