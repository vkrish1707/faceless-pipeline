import { describe, it, expect, beforeEach } from "vitest";
import { emit, emitRender } from "./emit";
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

describe("emit", () => {
  beforeEach(() => {
    setHubForTesting(null);
  });

  it("is a safe no-op when the hub is not attached", () => {
    expect(() =>
      emit({ jobId: "j1", status: "running", progress: 10 })
    ).not.toThrow();
  });

  it("broadcasts to 'global' on every emit", () => {
    const hub = new WsHub();
    setHubForTesting(hub);
    const sink = makeSink();
    hub.register(sink);
    hub.subscribe(sink, ["global"]);

    emit({ jobId: "j1", status: "running", progress: 50 });
    expect(sink.received).toHaveLength(1);
    expect(sink.received[0]).toMatchObject({
      type: "job.update",
      jobId: "j1",
      status: "running",
      progress: 50,
    });
  });

  it("also broadcasts to chapter:<id> when targetType=Chapter", () => {
    const hub = new WsHub();
    setHubForTesting(hub);
    const chapSink = makeSink();
    hub.register(chapSink);
    hub.subscribe(chapSink, ["chapter:c1"]);

    emit({
      jobId: "j2",
      status: "running",
      progress: 25,
      targetType: "Chapter",
      targetId: "c1",
    });
    expect(chapSink.received).toHaveLength(1);
  });

  it("also broadcasts to render:<id> when targetType=Render", () => {
    const hub = new WsHub();
    setHubForTesting(hub);
    const sink = makeSink();
    hub.register(sink);
    hub.subscribe(sink, ["render:r1"]);

    emit({
      jobId: "j3",
      status: "running",
      progress: 80,
      targetType: "Render",
      targetId: "r1",
    });
    expect(sink.received).toHaveLength(1);
    expect(sink.received[0]).toMatchObject({
      type: "job.update",
      jobId: "j3",
      progress: 80,
    });
  });

  it("includes error when provided", () => {
    const hub = new WsHub();
    setHubForTesting(hub);
    const sink = makeSink();
    hub.register(sink);
    hub.subscribe(sink, ["global"]);

    emit({
      jobId: "j4",
      status: "failed",
      progress: 0,
      error: "boom",
    });
    expect(sink.received[0]).toMatchObject({
      type: "job.update",
      jobId: "j4",
      status: "failed",
      error: "boom",
    });
  });
});

describe("emitRender", () => {
  beforeEach(() => {
    setHubForTesting(null);
  });

  it("is a safe no-op when the hub is not attached", () => {
    expect(() =>
      emitRender({ renderId: "r1", status: "render", progress: 50 })
    ).not.toThrow();
  });

  it("broadcasts so 'global' and render:<id> both receive exactly once", () => {
    const hub = new WsHub();
    setHubForTesting(hub);
    const g = makeSink();
    const r = makeSink();
    hub.register(g);
    hub.register(r);
    hub.subscribe(g, ["global"]);
    hub.subscribe(r, ["render:r1"]);

    emitRender({
      renderId: "r1",
      status: "render",
      progress: 50,
      videoPath: "/out/video.mp4",
    });

    expect(g.received).toHaveLength(1);
    expect(r.received).toHaveLength(1);
    expect(g.received[0]).toMatchObject({
      type: "render.update",
      renderId: "r1",
      videoPath: "/out/video.mp4",
    });
  });

  it("also broadcasts to chapter:<id> when chapterId is provided", () => {
    const hub = new WsHub();
    setHubForTesting(hub);
    const c = makeSink();
    hub.register(c);
    hub.subscribe(c, ["chapter:cid-1"]);

    emitRender({
      renderId: "r2",
      chapterId: "cid-1",
      status: "done",
      progress: 100,
    });
    expect(c.received).toHaveLength(1);
  });
});
