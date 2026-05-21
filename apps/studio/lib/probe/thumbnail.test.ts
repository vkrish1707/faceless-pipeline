import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { buildFfmpegThumbnailArgs, extractThumbnail } from "./thumbnail";

describe("buildFfmpegThumbnailArgs", () => {
  it("emits `-ss <t> -i <src> -vframes 1 -y <out>` argv", () => {
    expect(buildFfmpegThumbnailArgs("/in.mp4", "/out.jpg", 1.5)).toEqual([
      "-ss",
      "1.5",
      "-i",
      "/in.mp4",
      "-vframes",
      "1",
      "-y",
      "/out.jpg",
    ]);
  });
});

function makeFakeSpawn(code: number, stderr = "") {
  const calls: { cmd: string; args: ReadonlyArray<string> }[] = [];
  const spawnImpl = vi.fn((cmd: string, args: ReadonlyArray<string>) => {
    calls.push({ cmd, args });
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    setImmediate(() => {
      if (stderr) proc.stderr.emit("data", Buffer.from(stderr));
      proc.emit("close", code);
    });
    return proc as unknown as ReturnType<typeof spawnImpl>;
  });
  return { spawnImpl, calls };
}

describe("extractThumbnail", () => {
  it("invokes ffmpeg with the expected argv and resolves on exit 0", async () => {
    const { spawnImpl, calls } = makeFakeSpawn(0);
    await extractThumbnail({
      srcPath: "/in.mp4",
      outPath: "/out.jpg",
      atSec: 2.0,
      spawnImpl: spawnImpl as any,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toBe("ffmpeg");
    expect(calls[0]!.args).toEqual([
      "-ss",
      "2",
      "-i",
      "/in.mp4",
      "-vframes",
      "1",
      "-y",
      "/out.jpg",
    ]);
  });

  it("defaults to atSec=1 when omitted", async () => {
    const { spawnImpl, calls } = makeFakeSpawn(0);
    await extractThumbnail({
      srcPath: "/x.mp4",
      outPath: "/x.jpg",
      spawnImpl: spawnImpl as any,
    });
    expect(calls[0]!.args[1]).toBe("1");
  });

  it("rejects with stderr when ffmpeg exits non-zero", async () => {
    const { spawnImpl } = makeFakeSpawn(1, "could not open file");
    await expect(
      extractThumbnail({
        srcPath: "/x.mp4",
        outPath: "/x.jpg",
        spawnImpl: spawnImpl as any,
      })
    ).rejects.toThrow(/could not open file/);
  });
});
