import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  buildFfprobeArgs,
  parseFfprobeJson,
  probeMedia,
} from "./ffprobe";

describe("buildFfprobeArgs", () => {
  it("emits the canonical JSON-output argv with the input path last", () => {
    expect(buildFfprobeArgs("/abs/video.mp4")).toEqual([
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      "/abs/video.mp4",
    ]);
  });
});

describe("parseFfprobeJson", () => {
  it("reduces the streams + format to {width,height,durationSec,codec,hasAudio}", () => {
    const out = parseFfprobeJson({
      format: { duration: "30.123" },
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1080,
          height: 1920,
        },
        { codec_type: "audio", codec_name: "aac" },
      ],
    });
    expect(out).toEqual({
      width: 1080,
      height: 1920,
      durationSec: 30.123,
      codec: "h264",
      hasAudio: true,
    });
  });

  it("flags hasAudio=false when no audio stream is present", () => {
    const out = parseFfprobeJson({
      format: { duration: "5" },
      streams: [{ codec_type: "video", codec_name: "h264", width: 1080, height: 1920 }],
    });
    expect(out.hasAudio).toBe(false);
  });

  it("falls back to the video stream's duration when format duration is missing", () => {
    const out = parseFfprobeJson({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 100,
          height: 200,
          duration: "12.5",
        },
      ],
    });
    expect(out.durationSec).toBe(12.5);
  });

  it("throws when there is no video stream", () => {
    expect(() =>
      parseFfprobeJson({
        streams: [{ codec_type: "audio", codec_name: "aac" }],
      })
    ).toThrow(/no video stream/);
  });
});

/**
 * Build a fake `spawn` that immediately emits the supplied stdout/stderr then
 * closes with the given exit code. Used to drive probeMedia without launching
 * ffprobe.
 */
function makeFakeSpawn(opts: { stdout: string; stderr?: string; code: number }) {
  const calls: { cmd: string; args: ReadonlyArray<string> }[] = [];
  const spawnImpl = vi.fn((cmd: string, args: ReadonlyArray<string>): any => {
    calls.push({ cmd, args });
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    // Emit on next tick so listeners get attached first.
    setImmediate(() => {
      if (opts.stdout) proc.stdout.emit("data", Buffer.from(opts.stdout));
      if (opts.stderr) proc.stderr.emit("data", Buffer.from(opts.stderr));
      proc.emit("close", opts.code);
    });
    return proc as unknown as ReturnType<typeof spawnImpl>;
  });
  return { spawnImpl, calls };
}

describe("probeMedia", () => {
  it("happy path: returns the parsed ProbeResult", async () => {
    const stdout = JSON.stringify({
      format: { duration: "10.5" },
      streams: [
        { codec_type: "video", codec_name: "h264", width: 1080, height: 1920 },
        { codec_type: "audio", codec_name: "aac" },
      ],
    });
    const { spawnImpl, calls } = makeFakeSpawn({ stdout, code: 0 });
    const out = await probeMedia("/abs/video.mp4", { spawnImpl: spawnImpl as any });
    expect(out.width).toBe(1080);
    expect(out.height).toBe(1920);
    expect(out.codec).toBe("h264");
    expect(out.hasAudio).toBe(true);
    expect(out.durationSec).toBeCloseTo(10.5, 5);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args.at(-1)).toBe("/abs/video.mp4");
  });

  it("rejects with the stderr text when ffprobe exits non-zero", async () => {
    const { spawnImpl } = makeFakeSpawn({
      stdout: "",
      stderr: "moov atom not found",
      code: 1,
    });
    await expect(
      probeMedia("/bad.mp4", { spawnImpl: spawnImpl as any })
    ).rejects.toThrow(/moov atom not found/);
  });

  it("rejects when stdout is unparseable", async () => {
    const { spawnImpl } = makeFakeSpawn({ stdout: "not json", code: 0 });
    await expect(
      probeMedia("/x.mp4", { spawnImpl: spawnImpl as any })
    ).rejects.toThrow(/failed to parse/i);
  });
});
