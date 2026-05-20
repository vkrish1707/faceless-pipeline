import { describe, it, expect } from "vitest";
import { parseWhisperJson } from "./whisper";

describe("parseWhisperJson", () => {
  it("flattens segments into a flat word array with start/end in seconds", () => {
    const fixture = {
      transcription: [
        {
          timestamps: { from: "00:00:00,000", to: "00:00:00,400" },
          offsets: { from: 0, to: 400 },
          text: "Hello",
        },
        {
          timestamps: { from: "00:00:00,400", to: "00:00:00,900" },
          offsets: { from: 400, to: 900 },
          text: "world",
        },
      ],
    };
    const result = parseWhisperJson(fixture);
    expect(result).toEqual({
      words: [
        { word: "Hello", start: 0.0, end: 0.4 },
        { word: "world", start: 0.4, end: 0.9 },
      ],
    });
  });

  it("trims whitespace and skips empty tokens", () => {
    const fixture = {
      transcription: [
        { offsets: { from: 0, to: 100 }, text: " hi " },
        { offsets: { from: 100, to: 200 }, text: "" },
      ],
    };
    const result = parseWhisperJson(fixture);
    expect(result.words).toEqual([{ word: "hi", start: 0.0, end: 0.1 }]);
  });
});
