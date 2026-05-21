"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type VoiceOption = {
  id: string;
  label: string;
  description: string;
  installed: boolean;
  sampleUrl: string;
};

export function VoicePicker({ voices, current }: { voices: VoiceOption[]; current: string }) {
  const [value, setValue] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const playingRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (playingRef.current) {
        playingRef.current.pause();
        playingRef.current = null;
      }
    };
  }, []);

  async function onChange(next: string) {
    if (next === value) return;
    setSaving(true);
    setError(null);
    const prev = value;
    setValue(next);
    try {
      const res = await fetch("/api/settings/voice", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `failed (${res.status})`);
        setValue(prev);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setValue(prev);
    } finally {
      setSaving(false);
    }
  }

  function playSample(url: string) {
    if (playingRef.current) playingRef.current.pause();
    const audio = new Audio(url);
    playingRef.current = audio;
    audio.play().catch((e) => {
      setError(`could not play sample: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  return (
    <div className="space-y-3">
      {voices.map((v) => {
        const isActive = value === v.id;
        return (
          <label
            key={v.id}
            className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors ${
              isActive ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
            }`}
          >
            <input
              type="radio"
              name="voice"
              value={v.id}
              checked={isActive}
              onChange={() => onChange(v.id)}
              disabled={saving || !v.installed}
              className="mt-1"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium">{v.label}</span>
                {v.installed ? (
                  <Badge variant="success">model installed</Badge>
                ) : (
                  <Badge variant="error" title={`Missing assets/voices/${v.id}.onnx`}>
                    run pnpm setup:piper
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{v.description}</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.preventDefault();
                playSample(v.sampleUrl);
              }}
            >
              ▶ Sample
            </Button>
          </label>
        );
      })}
      {error && <p className="text-sm text-red-300">{error}</p>}
    </div>
  );
}
