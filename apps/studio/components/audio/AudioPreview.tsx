"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { activeWordIndex, type ActiveWord } from "@/lib/audio/active-word";

type Word = ActiveWord & { word: string };

type CaptionsResponse = { words: Word[] };

export function AudioPreview({
  audioUrl,
  captionsUrl,
  warning,
}: {
  audioUrl: string;
  captionsUrl: string;
  warning?: string | null;
}) {
  const [words, setWords] = useState<Word[]>([]);
  const [active, setActive] = useState<number>(-1);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Bare ActiveWord[] reference for the binary search (stable identity).
  const barebones = useMemo(() => words.map((w) => ({ start: w.start, end: w.end })), [words]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(captionsUrl);
        if (!res.ok) {
          if (res.status === 410) {
            setError("Captions file is missing on disk. Click Regenerate audio to rebuild.");
          } else {
            setError(`Could not load captions (${res.status})`);
          }
          return;
        }
        const data = (await res.json()) as CaptionsResponse;
        if (!cancelled) setWords(data.words ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [captionsUrl]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => {
      const idx = activeWordIndex(barebones, el.currentTime);
      setActive(idx);
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("seeked", onTime);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("seeked", onTime);
    };
  }, [barebones]);

  function seek(t: number) {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = t;
    if (el.paused) el.play().catch(() => {});
  }

  return (
    <div className="space-y-3">
      <audio ref={audioRef} controls src={audioUrl} className="w-full" preload="metadata" />
      {warning && (
        <p className="text-xs text-yellow-300/80" title="non-fatal warning from the synthesize job">
          {warning}
        </p>
      )}
      {error && <p className="text-xs text-red-300">{error}</p>}
      <div className="flex flex-wrap gap-1 leading-relaxed">
        {words.map((w, i) => {
          const isActive = i === active;
          return (
            <button
              type="button"
              key={i}
              onClick={() => seek(w.start)}
              className={`px-1.5 py-0.5 rounded text-sm transition-all ease-out [transition-duration:80ms] ${
                isActive
                  ? "bg-primary text-primary-foreground scale-105"
                  : "text-foreground/80 hover:text-foreground"
              }`}
              title={`${w.start.toFixed(2)}s — ${w.end.toFixed(2)}s`}
            >
              {w.word}
            </button>
          );
        })}
      </div>
    </div>
  );
}
