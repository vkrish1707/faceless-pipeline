"use client";

import { useState } from "react";

interface Initial {
  enableMusic: boolean;
  renderConcurrency: number;
  musicGainDb: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

async function patchSetting(key: string, value: string): Promise<string | null> {
  const res = await fetch(`/api/settings/${encodeURIComponent(key)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (res.ok) return null;
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `failed (${res.status})`;
}

export function Phase7Settings({ initial }: { initial: Initial }) {
  const [enableMusic, setEnableMusic] = useState(initial.enableMusic);
  const [renderConcurrency, setRenderConcurrency] = useState(initial.renderConcurrency);
  const [musicGainDb, setMusicGainDb] = useState(initial.musicGainDb);
  const [logLevel, setLogLevel] = useState<Initial["logLevel"]>(initial.logLevel);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  async function save(key: string, value: string) {
    setSaving(key);
    setError(null);
    const err = await patchSetting(key, value);
    if (err) setError(`${key}: ${err}`);
    setSaving(null);
  }

  return (
    <>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Background music</h2>
        <p className="text-sm text-muted-foreground">
          When on, every new render mixes a tone-matched track under the voice at the configured gain.
        </p>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={enableMusic}
            disabled={saving === "enable_music"}
            onChange={async (e) => {
              setEnableMusic(e.target.checked);
              await save("enable_music", e.target.checked ? "true" : "false");
            }}
          />
          <span>Enable background music</span>
        </label>
        <label className="flex items-center gap-3">
          <span className="w-32 text-sm">Music gain (dB)</span>
          <input
            type="number"
            min={-40}
            max={0}
            step={1}
            value={musicGainDb}
            disabled={saving === "music_gain_db"}
            onChange={(e) => setMusicGainDb(Number.parseFloat(e.target.value))}
            onBlur={() => save("music_gain_db", String(musicGainDb))}
            className="border rounded px-2 py-1 w-24 text-sm"
          />
        </label>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Render concurrency</h2>
        <p className="text-sm text-muted-foreground">
          How many Remotion renders run in parallel. Higher uses more CPU/GPU; the default (2) is the M3 sweet spot.
        </p>
        <label className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={4}
            step={1}
            value={renderConcurrency}
            disabled={saving === "render_concurrency"}
            onChange={(e) => setRenderConcurrency(Number.parseInt(e.target.value, 10))}
            onMouseUp={() => save("render_concurrency", String(renderConcurrency))}
            onTouchEnd={() => save("render_concurrency", String(renderConcurrency))}
            className="flex-1 max-w-xs"
          />
          <span className="font-mono text-sm w-6 text-right">{renderConcurrency}</span>
        </label>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Log level</h2>
        <p className="text-sm text-muted-foreground">
          Filters the lines written to <code>logs/studio-&lt;today&gt;.log</code>.
        </p>
        <select
          value={logLevel}
          disabled={saving === "log_level"}
          onChange={async (e) => {
            const v = e.target.value as Initial["logLevel"];
            setLogLevel(v);
            await save("log_level", v);
          }}
          className="border rounded px-2 py-1 text-sm"
        >
          {LOG_LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </section>

      {error && <p className="text-sm text-red-300">{error}</p>}
    </>
  );
}
