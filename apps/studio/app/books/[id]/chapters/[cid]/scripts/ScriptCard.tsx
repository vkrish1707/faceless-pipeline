"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AudioPreview } from "@/components/audio/AudioPreview";

type Beat = {
  start: number;
  end: number;
  keywords: string[];
  mediaType: string;
  tone: string;
  chart?: { kind: string; label: string; bigNumber?: string };
};

type Metadata = {
  youtubeTitle: string;
  caption: string;
  hashtags: string[];
  thumbnailConcept: string;
};

export type RenderInfo = {
  id: string;
  status: string;
  progress: number;
  error: string | null;
  warning: string | null;
  audioUrl: string | null;
  captionsUrl: string | null;
  videoUrl: string | null;
  durationSec: number | null;
};

export type ScriptCardData = {
  ideaId: string;
  ideaTitle: string;
  targetLengthSec: number;
  script: {
    id: string;
    hook: string;
    body: string;
    cta: string;
    score: number | null;
    visualBeats: Beat[];
    metadata: Metadata;
    warnings: Array<{ kind: string; detail: string }>;
    lastEditedAt: string | null;
    generatedAt: string | null;
    render: RenderInfo | null;
    /** How many beats have a non-null pickedAssetId. Used by the Render gate. */
    pickedAssetCount: number;
    /** Total beat count — gate enabled when pickedAssetCount === totalBeatCount. */
    totalBeatCount: number;
  } | null;
};

type SynthJobInfo = { jobId: string; status: string; progress: number; error: string | null };
type RenderJobInfo = { jobId: string; status: string; progress: number; error: string | null };

const DEBOUNCE_MS = 800;

export function ScriptCard({ data }: { data: ScriptCardData }) {
  const router = useRouter();
  const [script, setScript] = useState(data.script);
  const [hook, setHook] = useState(data.script?.hook ?? "");
  const [body, setBody] = useState(data.script?.body ?? "");
  const [cta, setCta] = useState(data.script?.cta ?? "");
  const [metaTitle, setMetaTitle] = useState(data.script?.metadata.youtubeTitle ?? "");
  const [metaCaption, setMetaCaption] = useState(data.script?.metadata.caption ?? "");
  const [metaHashtags, setMetaHashtags] = useState((data.script?.metadata.hashtags ?? []).join(" "));
  const [metaThumb, setMetaThumb] = useState(data.script?.metadata.thumbnailConcept ?? "");
  const [savingState, setSavingState] = useState<"idle" | "saving" | "saved" | "rescoring">("idle");
  const [rescoreJobId, setRescoreJobId] = useState<string | null>(null);
  const [synthJob, setSynthJob] = useState<SynthJobInfo | null>(null);
  const [synthBusy, setSynthBusy] = useState(false);
  const synthRefreshedRef = useRef(false);
  const [renderJob, setRenderJob] = useState<RenderJobInfo | null>(null);
  const [renderBusy, setRenderBusy] = useState(false);
  const renderRefreshedRef = useRef(false);
  const [showMeta, setShowMeta] = useState(false);
  const [showBeats, setShowBeats] = useState(true);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const render = script?.render ?? null;
  const synthActive = synthJob?.status === "queued" || synthJob?.status === "running";
  const hasFinishedRender = render?.status === "done" && !!render.audioUrl && !!render.captionsUrl;

  // Render gate (matches /api/scripts/[id]/render's preconditions exactly):
  //   - audio + captions present
  //   - every beat has a pickedAssetId
  //   - no render_script job currently running
  const renderActive = renderJob?.status === "queued" || renderJob?.status === "running";
  const renderGateMissing: string[] = [];
  if (script) {
    if (!render?.audioUrl) renderGateMissing.push("audio");
    if (!render?.captionsUrl) renderGateMissing.push("captions");
    if (script.totalBeatCount > 0 && script.pickedAssetCount < script.totalBeatCount) {
      renderGateMissing.push(
        `pick ${script.totalBeatCount - script.pickedAssetCount} more beat${
          script.totalBeatCount - script.pickedAssetCount === 1 ? "" : "s"
        }`
      );
    }
  }
  const renderEnabled = !!script && renderGateMissing.length === 0 && !renderActive && !synthActive;
  const hasFinishedVideo = render?.status === "done" && !!render.videoUrl;

  useEffect(() => {
    if (!data.script) return;
    setScript(data.script);
    setHook(data.script.hook);
    setBody(data.script.body);
    setCta(data.script.cta);
    setMetaTitle(data.script.metadata.youtubeTitle);
    setMetaCaption(data.script.metadata.caption);
    setMetaHashtags(data.script.metadata.hashtags.join(" "));
    setMetaThumb(data.script.metadata.thumbnailConcept);
  }, [data.script]);

  useEffect(() => {
    if (!rescoreJobId) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || document.hidden) return;
      try {
        const res = await fetch(`/api/jobs/${rescoreJobId}`, { cache: "no-store" });
        if (!res.ok) return;
        const j = await res.json();
        if (j.status === "completed" || j.status === "failed") {
          setRescoreJobId(null);
          setSavingState("idle");
          router.refresh();
        }
      } catch {
        /* transient */
      }
    };
    const iv = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [rescoreJobId, router]);

  useEffect(() => {
    if (!synthActive || !synthJob) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || document.hidden) return;
      try {
        const res = await fetch(`/api/jobs/${synthJob.jobId}`, { cache: "no-store" });
        if (!res.ok) return;
        const j = await res.json();
        if (cancelled) return;
        setSynthJob({ jobId: j.id, status: j.status, progress: j.progress, error: j.error });
        if ((j.status === "completed" || j.status === "failed") && !synthRefreshedRef.current) {
          synthRefreshedRef.current = true;
          router.refresh();
        }
      } catch {
        /* transient */
      }
    };
    const iv = setInterval(tick, 2000);
    const onVis = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [synthActive, synthJob, router]);

  useEffect(() => {
    if (!renderActive || !renderJob) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || document.hidden) return;
      try {
        const res = await fetch(`/api/jobs/${renderJob.jobId}`, { cache: "no-store" });
        if (!res.ok) return;
        const j = await res.json();
        if (cancelled) return;
        setRenderJob({ jobId: j.id, status: j.status, progress: j.progress, error: j.error });
        if ((j.status === "completed" || j.status === "failed") && !renderRefreshedRef.current) {
          renderRefreshedRef.current = true;
          router.refresh();
        }
      } catch {
        /* transient */
      }
    };
    const iv = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [renderActive, renderJob, router]);

  function queueSave(partial: Record<string, unknown>) {
    if (!script) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(partial), DEBOUNCE_MS);
  }

  async function save(partial: Record<string, unknown>) {
    if (!script) return;
    setSavingState("saving");
    try {
      const res = await fetch(`/api/scripts/${script.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(partial),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`Save failed: ${data.error ?? res.statusText}`);
        setSavingState("idle");
        return;
      }
      if (data.rescoreJobId) {
        setRescoreJobId(data.rescoreJobId);
        setSavingState("rescoring");
      } else {
        setSavingState("saved");
        setTimeout(() => setSavingState("idle"), 1500);
      }
    } catch (err) {
      setSavingState("idle");
    }
  }

  async function manualRescore() {
    if (!script) return;
    const res = await fetch(`/api/scripts/${script.id}/rescore`, { method: "POST" });
    if (!res.ok) return;
    const d = await res.json();
    setRescoreJobId(d.jobId);
    setSavingState("rescoring");
  }

  async function synthesize() {
    if (!script) return;
    setSynthBusy(true);
    synthRefreshedRef.current = false;
    try {
      const res = await fetch(`/api/scripts/${script.id}/synthesize`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) {
        alert(`Could not start synthesis: ${d.error ?? res.statusText}`);
        return;
      }
      setSynthJob({ jobId: d.jobId, status: "queued", progress: 0, error: null });
    } finally {
      setSynthBusy(false);
    }
  }

  async function renderVideo() {
    if (!script) return;
    setRenderBusy(true);
    renderRefreshedRef.current = false;
    try {
      const res = await fetch(`/api/scripts/${script.id}/render`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) {
        const missing = Array.isArray(d.missing) ? ` (${d.missing.join(", ")})` : "";
        alert(`Could not start render: ${d.error ?? res.statusText}${missing}`);
        return;
      }
      setRenderJob({ jobId: d.jobId, status: "queued", progress: 0, error: null });
    } finally {
      setRenderBusy(false);
    }
  }

  async function reveal() {
    if (!render) return;
    try {
      await fetch(`/api/renders/${render.id}/reveal`, { method: "POST" });
    } catch {
      /* best-effort, ignore */
    }
  }

  async function rerender() {
    if (!render) return;
    setRenderBusy(true);
    renderRefreshedRef.current = false;
    try {
      const res = await fetch(`/api/renders/${render.id}/rerender`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) {
        alert(`Could not re-render: ${d.error ?? res.statusText}`);
        return;
      }
      setRenderJob({ jobId: d.jobId, status: "queued", progress: 0, error: null });
    } finally {
      setRenderBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }

  if (!script) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{data.ideaTitle}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <Badge variant="warn">generating…</Badge>
        </CardContent>
      </Card>
    );
  }

  const scoreVariant = script.score == null ? "outline" : script.score >= 80 ? "success" : script.score >= 60 ? "warn" : "outline";
  const synthLabel = hasFinishedRender ? "Regenerate audio" : "Synthesize";

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <CardTitle className="text-base leading-snug">{data.ideaTitle}</CardTitle>
        <div className="flex items-center gap-2 shrink-0">
          {savingState === "saving" && <span className="text-xs text-muted-foreground">saving…</span>}
          {savingState === "saved" && <span className="text-xs text-green-400">saved</span>}
          {savingState === "rescoring" && <span className="text-xs text-yellow-300">score updating…</span>}
          {render?.status === "failed" && (
            <Badge variant="error" title={render.error ?? ""}>synth failed</Badge>
          )}
          {synthActive && (
            <Badge variant="warn">
              {synthJob!.status} {synthJob!.progress}%
            </Badge>
          )}
          {hasFinishedRender && render?.durationSec != null && (
            <Badge variant="outline">{render.durationSec.toFixed(1)}s</Badge>
          )}
          <Badge variant={scoreVariant}>{script.score ?? "—"}</Badge>
          <Badge variant="outline">{data.targetLengthSec}s</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {script.warnings.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {script.warnings.map((w, i) => (
              <Badge key={i} variant="warn" title={w.detail}>{w.kind.replace("_", " ")}</Badge>
            ))}
          </div>
        )}

        <Field
          label={`hook (${hook.length}/180)`}
          warn={hook.length > 180}
        >
          <input
            value={hook}
            onChange={(e) => {
              setHook(e.target.value);
              queueSave({ hook: e.target.value });
            }}
            className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
          />
        </Field>

        <Field label={`body (${countWords(body)} words)`}>
          <textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              queueSave({ body: e.target.value });
            }}
            rows={4}
            className="w-full rounded border border-border bg-background px-2 py-1 text-sm leading-relaxed"
          />
        </Field>

        <Field label={`cta (${cta.length}/120)`} warn={cta.length > 120}>
          <input
            value={cta}
            onChange={(e) => {
              setCta(e.target.value);
              queueSave({ cta: e.target.value });
            }}
            className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
          />
        </Field>

        <div className="space-y-1">
          <button
            onClick={() => setShowBeats((s) => !s)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {showBeats ? "▾" : "▸"} visual beats ({script.visualBeats.length})
          </button>
          {showBeats && (
            <ul className="text-xs space-y-1 ml-3">
              {script.visualBeats.map((b, i) => (
                <li key={i} className="text-muted-foreground">
                  {b.start}–{b.end}s · {b.keywords.join(", ")} · {b.tone} · {b.mediaType}
                  {b.chart && <span className="ml-1 text-yellow-300">✨ chart</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-1">
          <button onClick={() => setShowMeta((s) => !s)} className="text-xs text-muted-foreground hover:text-foreground">
            {showMeta ? "▾" : "▸"} metadata
          </button>
          {showMeta && (
            <div className="space-y-2 ml-3">
              <div className="flex items-center gap-2">
                <input
                  value={metaTitle}
                  onChange={(e) => {
                    setMetaTitle(e.target.value);
                    queueSave({ metadata: { youtubeTitle: e.target.value } });
                  }}
                  placeholder="youtube title"
                  className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
                />
                <Button size="sm" variant="ghost" onClick={() => copy(metaTitle)}>copy</Button>
              </div>
              <div className="flex items-start gap-2">
                <textarea
                  value={metaCaption}
                  onChange={(e) => {
                    setMetaCaption(e.target.value);
                    queueSave({ metadata: { caption: e.target.value } });
                  }}
                  rows={2}
                  placeholder="caption"
                  className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
                />
                <Button size="sm" variant="ghost" onClick={() => copy(metaCaption)}>copy</Button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={metaHashtags}
                  onChange={(e) => {
                    setMetaHashtags(e.target.value);
                    const tags = e.target.value
                      .split(/\s+/)
                      .filter((t) => /^#[a-zA-Z0-9_]+$/.test(t));
                    queueSave({ metadata: { hashtags: tags } });
                  }}
                  placeholder="#hashtag #hashtag"
                  className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs font-mono"
                />
                <Button size="sm" variant="ghost" onClick={() => copy(metaHashtags)}>copy</Button>
              </div>
              <div className="flex items-start gap-2">
                <textarea
                  value={metaThumb}
                  onChange={(e) => {
                    setMetaThumb(e.target.value);
                    queueSave({ metadata: { thumbnailConcept: e.target.value } });
                  }}
                  rows={2}
                  placeholder="thumbnail concept"
                  className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
                />
              </div>
            </div>
          )}
        </div>

        {hasFinishedRender && render?.audioUrl && render.captionsUrl && !hasFinishedVideo && (
          <AudioPreview
            audioUrl={render.audioUrl}
            captionsUrl={render.captionsUrl}
            warning={render.warning}
          />
        )}

        {hasFinishedVideo && render?.videoUrl && (
          <div className="space-y-1">
            <video
              controls
              src={render.videoUrl}
              className="w-full rounded-md bg-black"
              style={{ maxHeight: 480 }}
            />
            {render.warning && (
              <p className="text-xs text-yellow-300">warning: {render.warning}</p>
            )}
          </div>
        )}

        {renderActive && renderJob && (
          <div className="text-xs text-muted-foreground">
            rendering… {renderJob.status} {renderJob.progress}%
          </div>
        )}
        {render?.status === "failed" && render.error && (
          <p className="text-xs text-red-400" title={render.error}>
            render failed: {render.error.split("\n")[0]}
          </p>
        )}

        <div className="flex items-center gap-2 pt-1 flex-wrap">
          <Button size="sm" variant="outline" onClick={manualRescore} disabled={savingState === "rescoring"}>
            Re-score
          </Button>
          <Button size="sm" onClick={synthesize} disabled={synthBusy || synthActive}>
            {synthLabel}
          </Button>
          <Button
            size="sm"
            onClick={renderVideo}
            disabled={!renderEnabled || renderBusy}
            title={
              renderGateMissing.length > 0
                ? `Render needs: ${renderGateMissing.join(", ")}`
                : "Render to MP4 via Remotion"
            }
          >
            {hasFinishedVideo ? "Render again" : "Render"}
          </Button>
          {hasFinishedVideo && (
            <>
              <Button size="sm" variant="outline" onClick={rerender} disabled={renderBusy || renderActive}>
                Re-render
              </Button>
              <Button size="sm" variant="ghost" onClick={reveal}>
                Open folder
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, warn, children }: { label: string; warn?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className={`text-xs ${warn ? "text-red-400" : "text-muted-foreground"}`}>{label}</div>
      {children}
    </div>
  );
}

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}
