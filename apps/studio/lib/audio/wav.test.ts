import { describe, it, expect } from "vitest";
import { parseWavHeader, WavParseError } from "./wav";

/**
 * Build a 44-byte WAV header in-memory so the test doesn't depend on a
 * committed binary fixture. Returns a Buffer of exactly HEADER_BYTES.
 */
function buildHeader(opts: {
  audioFormat?: number;
  channels?: number;
  sampleRate?: number;
  bitsPerSample?: number;
  dataBytes?: number;
  riff?: string;
  wave?: string;
}): Buffer {
  const audioFormat = opts.audioFormat ?? 1;
  const channels = opts.channels ?? 1;
  const sampleRate = opts.sampleRate ?? 22050;
  const bitsPerSample = opts.bitsPerSample ?? 16;
  const dataBytes = opts.dataBytes ?? 44100;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  const buf = Buffer.alloc(44);
  buf.write(opts.riff ?? "RIFF", 0, 4, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4); // chunk size
  buf.write(opts.wave ?? "WAVE", 8, 4, "ascii");
  buf.write("fmt ", 12, 4, "ascii");
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(audioFormat, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write("data", 36, 4, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}

describe("parseWavHeader", () => {
  it("extracts sampleRate, channels, dataBytes, and computes duration for 16-bit mono Piper-style WAV", () => {
    // 22050 Hz mono * 1 sec at 16-bit = 44100 bytes
    const buf = buildHeader({ sampleRate: 22050, dataBytes: 44100 });
    const h = parseWavHeader(buf);
    expect(h.sampleRate).toBe(22050);
    expect(h.channels).toBe(1);
    expect(h.dataBytes).toBe(44100);
    expect(h.durationSec).toBeCloseTo(1.0, 5);
  });

  it("computes fileSizeMB from header+data when totalFileBytes not provided", () => {
    const dataBytes = 1024 * 1024; // 1 MiB of audio
    const buf = buildHeader({ dataBytes });
    const h = parseWavHeader(buf);
    // header (44) + dataBytes / (1024*1024)
    expect(h.fileSizeMB).toBeGreaterThan(1.0);
    expect(h.fileSizeMB).toBeLessThan(1.001);
  });

  it("uses the supplied totalFileBytes when given", () => {
    const buf = buildHeader({ dataBytes: 1000 });
    const h = parseWavHeader(buf, 2 * 1024 * 1024);
    expect(h.fileSizeMB).toBeCloseTo(2.0, 3);
  });

  it("throws WavParseError when buffer is truncated", () => {
    expect(() => parseWavHeader(Buffer.alloc(10))).toThrow(WavParseError);
  });

  it("throws when RIFF magic is wrong", () => {
    const buf = buildHeader({ riff: "XXXX" });
    expect(() => parseWavHeader(buf)).toThrow(/RIFF/);
  });

  it("throws when WAVE magic is wrong", () => {
    const buf = buildHeader({ wave: "XXXX" });
    expect(() => parseWavHeader(buf)).toThrow(/WAVE/);
  });

  it("throws on non-PCM audio format", () => {
    const buf = buildHeader({ audioFormat: 3 });
    expect(() => parseWavHeader(buf)).toThrow(/PCM/);
  });

  it("throws on stereo (channels != 1)", () => {
    const buf = buildHeader({ channels: 2 });
    expect(() => parseWavHeader(buf)).toThrow(/mono/);
  });

  it("throws on non-16-bit samples", () => {
    const buf = buildHeader({ bitsPerSample: 24 });
    expect(() => parseWavHeader(buf)).toThrow(/16-bit/);
  });
});
