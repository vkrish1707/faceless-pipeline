import pLimit, { type LimitFunction } from "p-limit";
import { db } from "../db";
import { emit } from "./emit";
import type { JobHandler, JobType } from "./types";

const handlers = new Map<JobType, JobHandler>();

export function registerHandler<P, R>(type: JobType, handler: JobHandler<P, R>): void {
  handlers.set(type, handler as JobHandler); // generic param erasure — Map is homogeneous
}

export function _resetHandlers(): void {
  handlers.clear();
}

export async function recoverOrphans(): Promise<number> {
  const res = await db.job.updateMany({
    where: { status: "running" },
    data: { status: "failed", error: "interrupted", completedAt: new Date() },
  });
  return res.count;
}

/**
 * App-wide concurrency cap for `render_script` jobs. Read once on first use
 * from the `render_concurrency` Setting (default 2) and recomputed on demand
 * via `setRenderConcurrency`. Other job types are unaffected — they run
 * one-per-`enqueueAndRun` call as before.
 */
const DEFAULT_RENDER_CONCURRENCY = 2;
let renderLimit: LimitFunction | null = null;
let renderConcurrency = DEFAULT_RENDER_CONCURRENCY;

async function readRenderConcurrencyFromSettings(): Promise<number> {
  try {
    const row = await db.setting.findUnique({ where: { key: "render_concurrency" } });
    if (!row) return DEFAULT_RENDER_CONCURRENCY;
    const n = Number.parseInt(row.value, 10);
    if (!Number.isFinite(n) || n < 1) return DEFAULT_RENDER_CONCURRENCY;
    return Math.min(8, n);
  } catch {
    return DEFAULT_RENDER_CONCURRENCY;
  }
}

export async function getRenderConcurrency(): Promise<number> {
  return readRenderConcurrencyFromSettings();
}

/**
 * Manually adjust the in-process concurrency cap. Used by the settings API
 * route after a user changes the value so live changes take effect without a
 * restart. Tests use this to set deterministic limits.
 */
export function setRenderConcurrency(n: number): void {
  renderConcurrency = Math.max(1, Math.min(8, Math.floor(n)));
  renderLimit = pLimit(renderConcurrency);
}

export function _resetRenderLimiterForTests(): void {
  renderLimit = null;
  renderConcurrency = DEFAULT_RENDER_CONCURRENCY;
}

async function ensureRenderLimit(): Promise<LimitFunction> {
  if (!renderLimit) {
    renderConcurrency = await readRenderConcurrencyFromSettings();
    renderLimit = pLimit(renderConcurrency);
  }
  return renderLimit;
}

export async function runJob(jobId: string): Promise<void> {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  if (job.status !== "queued") return;
  const handler = handlers.get(job.type as JobType);
  if (!handler) {
    const failed = await db.job.update({
      where: { id: jobId },
      data: { status: "failed", error: `no handler for type ${job.type}`, completedAt: new Date() },
    });
    emit({
      jobId,
      jobType: job.type,
      status: failed.status,
      progress: failed.progress,
      targetType: failed.targetType,
      targetId: failed.targetId,
      error: failed.error,
    });
    return;
  }

  const running = await db.job.update({
    where: { id: jobId },
    data: { status: "running", startedAt: new Date(), progress: 10 },
  });
  emit({
    jobId,
    jobType: running.type,
    status: running.status,
    progress: running.progress,
    targetType: running.targetType,
    targetId: running.targetId,
  });

  try {
    const result = await handler(job.payload, {
      jobId,
      updateProgress: async (n: number) => {
        const updated = await db.job.update({
          where: { id: jobId },
          data: { progress: Math.max(0, Math.min(100, n)) },
        });
        emit({
          jobId,
          jobType: updated.type,
          status: updated.status,
          progress: updated.progress,
          targetType: updated.targetType,
          targetId: updated.targetId,
        });
      },
    });
    const done = await db.job.update({
      where: { id: jobId },
      data: { status: "completed", progress: 100, completedAt: new Date(), result: result ?? undefined },
    });
    emit({
      jobId,
      jobType: done.type,
      status: done.status,
      progress: done.progress,
      targetType: done.targetType,
      targetId: done.targetId,
    });
  } catch (err) {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    const failed = await db.job.update({
      where: { id: jobId },
      data: { status: "failed", error: message, completedAt: new Date() },
    });
    emit({
      jobId,
      jobType: failed.type,
      status: failed.status,
      progress: failed.progress,
      targetType: failed.targetType,
      targetId: failed.targetId,
      error: failed.error,
    });
  }
}

/**
 * Fire-and-forget queue entry point. For `render_script` jobs the handler
 * runs through an app-wide `p-limit` so the user's concurrency setting is
 * respected even when many jobs are enqueued back-to-back.
 */
export function enqueueAndRun(jobId: string): void {
  void enqueueAndRunAsync(jobId).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[jobs] runJob ${jobId} threw outside handler:`, err);
  });
}

async function enqueueAndRunAsync(jobId: string): Promise<void> {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) return;
  if (job.type === "render_script") {
    const limit = await ensureRenderLimit();
    await limit(() => runJob(jobId));
    return;
  }
  await runJob(jobId);
}
