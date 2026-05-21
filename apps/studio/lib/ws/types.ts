/**
 * Wire types for the studio's WebSocket protocol. See
 * `docs/superpowers/specs/2026-05-20-phase-7-render-queue-polish.md`.
 *
 * The server pushes ServerEvent; the client sends ClientMsg. There is no
 * authentication (single-user local-only).
 */

export type Scope = "global" | `chapter:${string}` | `render:${string}`;

export type ServerEvent =
  | {
      type: "job.update";
      jobId: string;
      jobType?: string;
      status: string;
      progress: number;
      targetType?: string;
      targetId?: string;
      error?: string;
    }
  | {
      type: "render.update";
      renderId: string;
      status: string;
      progress: number;
      videoPath?: string;
      error?: string;
    }
  | {
      type: "cost.update";
      todayUsd: number;
      bookUsd: number;
    }
  | {
      type: "hello";
      serverTime: number;
    };

export type ClientMsg =
  | { type: "subscribe"; scopes: Scope[] }
  | { type: "unsubscribe"; scopes: Scope[] }
  | { type: "ping" };
