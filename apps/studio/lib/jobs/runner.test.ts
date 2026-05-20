import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../db";
import { recoverOrphans, runJob, registerHandler, _resetHandlers } from "./runner";

describe("job runner", () => {
  beforeEach(async () => {
    _resetHandlers();
    await db.job.deleteMany();
  });

  it("transitions queued → running → completed on success and writes result", async () => {
    registerHandler("extract_ideas", async (_payload, ctx) => {
      await ctx.updateProgress(50);
      return { ok: true };
    });
    const job = await db.job.create({
      data: { type: "extract_ideas", status: "queued", targetType: "Chapter", targetId: "c1" },
    });
    await runJob(job.id);
    const after = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe("completed");
    expect(after.progress).toBe(100);
    expect(after.result).toEqual({ ok: true });
    expect(after.completedAt).not.toBeNull();
  });

  it("transitions to failed on handler throw and writes error", async () => {
    registerHandler("extract_ideas", async () => {
      throw new Error("boom");
    });
    const job = await db.job.create({
      data: { type: "extract_ideas", status: "queued", targetType: "Chapter", targetId: "c2" },
    });
    await runJob(job.id);
    const after = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe("failed");
    expect(after.error).toContain("boom");
  });

  it("recoverOrphans marks running jobs as failed", async () => {
    await db.job.create({
      data: { type: "extract_ideas", status: "running", targetType: "Chapter", targetId: "c3" },
    });
    await db.job.create({
      data: { type: "extract_ideas", status: "queued", targetType: "Chapter", targetId: "c4" },
    });
    const n = await recoverOrphans();
    expect(n).toBe(1);
    const running = await db.job.findMany({ where: { status: "running" } });
    expect(running).toHaveLength(0);
    const failed = await db.job.findMany({ where: { status: "failed" } });
    expect(failed).toHaveLength(1);
    expect(failed[0]!.error).toBe("interrupted");
  });
});
