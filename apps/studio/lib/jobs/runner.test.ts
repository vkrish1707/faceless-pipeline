import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../db";
import {
  recoverOrphans,
  runJob,
  registerHandler,
  _resetHandlers,
  _resetRenderLimiterForTests,
  setRenderConcurrency,
  enqueueAndRun,
} from "./runner";
import { WsHub, setHubForTesting, type SocketLike } from "../ws/hub";

function makeSink(): SocketLike & { received: unknown[] } {
  const received: unknown[] = [];
  return {
    readyState: 1,
    received,
    send: (data: string) => {
      received.push(JSON.parse(data));
    },
    ping: () => {},
    terminate: () => {},
    close: () => {},
    on: () => {},
  } as unknown as SocketLike & { received: unknown[] };
}

describe("job runner", () => {
  beforeEach(async () => {
    _resetHandlers();
    _resetRenderLimiterForTests();
    setHubForTesting(null);
    await db.job.deleteMany();
    await db.setting.deleteMany();
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

  it("emits a job.update broadcast after every status transition", async () => {
    const hub = new WsHub();
    setHubForTesting(hub);
    const sink = makeSink();
    hub.register(sink);
    hub.subscribe(sink, ["chapter:c-emit"]);

    registerHandler("extract_ideas", async (_p, ctx) => {
      await ctx.updateProgress(40);
      return { ok: true };
    });
    const job = await db.job.create({
      data: { type: "extract_ideas", status: "queued", targetType: "Chapter", targetId: "c-emit" },
    });
    await runJob(job.id);

    // Expect: running (10), progress (40), completed (100) — at least three.
    const updates = sink.received.filter(
      (e) => (e as { type: string }).type === "job.update"
    );
    expect(updates.length).toBeGreaterThanOrEqual(3);
    const statuses = updates.map((e) => (e as { status: string }).status);
    expect(statuses).toContain("running");
    expect(statuses).toContain("completed");
  });
});

describe("render concurrency cap", () => {
  beforeEach(async () => {
    _resetHandlers();
    _resetRenderLimiterForTests();
    setHubForTesting(null);
    await db.job.deleteMany();
    await db.setting.deleteMany();
  });

  it("enqueueAndRun serialises render_script jobs through the configured limit", async () => {
    let active = 0;
    let peak = 0;
    registerHandler("render_script", async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 30));
      active -= 1;
      return { ok: true };
    });

    setRenderConcurrency(2);

    const jobs = await Promise.all(
      Array.from({ length: 5 }).map((_, i) =>
        db.job.create({
          data: {
            type: "render_script",
            status: "queued",
            targetType: "Render",
            targetId: `r-${i}`,
            payload: { scriptId: `s-${i}` },
          },
        })
      )
    );
    await Promise.all(
      jobs.map(
        (j) =>
          new Promise<void>((resolve) => {
            enqueueAndRun(j.id);
            // poll for completion
            const check = setInterval(async () => {
              const row = await db.job.findUnique({ where: { id: j.id } });
              if (row && (row.status === "completed" || row.status === "failed")) {
                clearInterval(check);
                resolve();
              }
            }, 10);
          })
      )
    );

    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThanOrEqual(1);
    const finals = await db.job.findMany({ where: { type: "render_script" } });
    expect(finals.every((f) => f.status === "completed")).toBe(true);
  });
});
