/**
 * Thin glue between the job runner / render orchestrator and the WS hub.
 *
 * `emit` and `emitRender` are safe no-ops when the hub hasn't been attached
 * (e.g. during vitest runs). They look up the singleton hub through
 * `getHub()` and broadcast to the relevant scopes.
 */

import { getHub } from "../ws/hub";
import type { Scope } from "../ws/types";

export interface EmitJobArgs {
  jobId: string;
  jobType?: string;
  status: string;
  progress: number;
  targetType?: string;
  targetId?: string;
  error?: string | null;
}

export interface EmitRenderArgs {
  renderId: string;
  scriptId?: string;
  chapterId?: string;
  status: string;
  progress: number;
  videoPath?: string | null;
  error?: string | null;
}

/**
 * Broadcast a job.update for the given job. Targets the "global" scope plus
 * a target-specific scope when applicable (chapter:<id> or render:<id>).
 */
export function emit(args: EmitJobArgs): void {
  const hub = getHub();
  if (!hub) return;
  const payload = {
    type: "job.update" as const,
    jobId: args.jobId,
    jobType: args.jobType,
    status: args.status,
    progress: args.progress,
    targetType: args.targetType,
    targetId: args.targetId,
    ...(args.error ? { error: args.error } : {}),
  };
  // The hub treats "global" subscribers as wildcard listeners — they receive
  // every broadcast regardless of scope. So we only need to emit once, to
  // the most specific scope available.
  if (args.targetType === "Chapter" && args.targetId) {
    hub.broadcast(`chapter:${args.targetId}` as Scope, payload);
  } else if (args.targetType === "Render" && args.targetId) {
    hub.broadcast(`render:${args.targetId}` as Scope, payload);
  } else {
    hub.broadcast("global", payload);
  }
}

/**
 * Broadcast a render.update. Targets "global", the per-render scope, and
 * (when known) the chapter scope.
 */
export function emitRender(args: EmitRenderArgs): void {
  const hub = getHub();
  if (!hub) return;
  const payload = {
    type: "render.update" as const,
    renderId: args.renderId,
    status: args.status,
    progress: args.progress,
    ...(args.videoPath ? { videoPath: args.videoPath } : {}),
    ...(args.error ? { error: args.error } : {}),
  };
  // Prefer the chapter scope when known so chapter listeners get the event
  // and "global" wildcards still match. Otherwise scope to the render id.
  if (args.chapterId) {
    hub.broadcast(`chapter:${args.chapterId}` as Scope, payload);
  } else {
    hub.broadcast(`render:${args.renderId}` as Scope, payload);
  }
}
