/**
 * Minimal WAV header parser. Reads the first 44 bytes of a RIFF/WAVE file
 * and extracts sample rate, channel count, data size, and computed duration.
 *
 * We assume 16-bit PCM mono — which is what Piper emits — and throw if the
 * header says anything else. This avoids a dependency on ffprobe for the
 * simple case the studio actually cares about.
 */
export type WavHeader = {
  sampleRate: number;
  channels: number;
  dataBytes: number;
  durationSec: number;
  fileSizeMB: number;
};

const HEADER_BYTES = 44;

export class WavParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WavParseError";
  }
}

/**
 * Parse a 44-byte WAV header. Pure — no fs, no async.
 *
 * Throws WavParseError if:
 *   - buffer is shorter than 44 bytes
 *   - "RIFF" / "WAVE" magic is missing
 *   - audio format is not PCM (1)
 *   - bits-per-sample is not 16
 *   - channel count is not 1 (mono)
 */
export function parseWavHeader(buf: Buffer, totalFileBytes?: number): WavHeader {
  if (buf.length < HEADER_BYTES) {
    throw new WavParseError(`WAV header truncated: got ${buf.length} bytes, need ${HEADER_BYTES}`);
  }

  const riff = buf.toString("ascii", 0, 4);
  if (riff !== "RIFF") {
    throw new WavParseError(`not a RIFF file (got "${riff}")`);
  }
  const wave = buf.toString("ascii", 8, 12);
  if (wave !== "WAVE") {
    throw new WavParseError(`not a WAVE file (got "${wave}")`);
  }

  const audioFormat = buf.readUInt16LE(20);
  if (audioFormat !== 1) {
    throw new WavParseError(`expected PCM (format=1), got format=${audioFormat}`);
  }

  const channels = buf.readUInt16LE(22);
  if (channels !== 1) {
    throw new WavParseError(`expected mono (channels=1), got channels=${channels}`);
  }

  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);
  if (bitsPerSample !== 16) {
    throw new WavParseError(`expected 16-bit samples, got bitsPerSample=${bitsPerSample}`);
  }

  const dataBytes = buf.readUInt32LE(40);
  const bytesPerSample = bitsPerSample / 8;
  const durationSec = dataBytes / (sampleRate * channels * bytesPerSample);

  const fileBytes = totalFileBytes ?? HEADER_BYTES + dataBytes;
  const fileSizeMB = fileBytes / (1024 * 1024);

  return { sampleRate, channels, dataBytes, durationSec, fileSizeMB };
}
