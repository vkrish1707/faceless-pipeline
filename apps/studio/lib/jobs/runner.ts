import { db } from "../db";
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

export async function runJob(jobId: string): Promise<void> {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  if (job.status !== "queued") return;
  const handler = handlers.get(job.type as JobType);
  if (!handler) {
    await db.job.update({
      where: { id: jobId },
      data: { status: "failed", error: `no handler for type ${job.type}`, completedAt: new Date() },
    });
    return;
  }

  await db.job.update({
    where: { id: jobId },
    data: { status: "running", startedAt: new Date(), progress: 10 },
  });

  try {
    const result = await handler(job.payload, {
      jobId,
      updateProgress: async (n: number) => {
        await db.job.update({ where: { id: jobId }, data: { progress: Math.max(0, Math.min(100, n)) } });
      },
    });
    await db.job.update({
      where: { id: jobId },
      data: { status: "completed", progress: 100, completedAt: new Date(), result: result ?? undefined },
    });
  } catch (err) {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    await db.job.update({
      where: { id: jobId },
      data: { status: "failed", error: message, completedAt: new Date() },
    });
  }
}

export function enqueueAndRun(jobId: string): void {
  // Fire-and-forget; errors are persisted by runJob itself.
  runJob(jobId).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[jobs] runJob ${jobId} threw outside handler:`, err);
  });
}
