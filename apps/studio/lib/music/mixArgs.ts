/**
 * Pure argv builder for the background-music mix. Kept separate from
 * `mixAudio.ts` so we can unit-test the exact ffmpeg invocation without
 * touching child_process.
 *
 * The filter graph routes the music track through a `volume` filter
 * (dB-based) and an infinite `aloop`, then mixes it with the voice track
 * truncated to the voice's duration. We `-c:v copy` so re-encoding the
 * video stream is avoided; only the audio is re-encoded to AAC.
 */

export interface MixArgsInput {
  videoPath: string;
  musicPath: string;
  outPath: string;
  /** Gain applied to the music track in dB (e.g. -18). */
  gainDb?: number;
}

export const DEFAULT_GAIN_DB = -18;

export function buildMixArgs(input: MixArgsInput): string[] {
  const gain = input.gainDb ?? DEFAULT_GAIN_DB;
  const gainStr = Number.isFinite(gain) ? String(gain) : String(DEFAULT_GAIN_DB);
  const filter = [
    `[1:a]volume=${gainStr}dB,aloop=loop=-1:size=2e9[bg]`,
    `[0:a][bg]amix=inputs=2:duration=shortest[a]`,
  ].join(";");
  return [
    "-y",
    "-i",
    input.videoPath,
    "-i",
    input.musicPath,
    "-filter_complex",
    filter,
    "-map",
    "0:v",
    "-map",
    "[a]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    input.outPath,
  ];
}
