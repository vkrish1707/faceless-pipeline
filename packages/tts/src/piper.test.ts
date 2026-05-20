import { describe, it, expect } from "vitest";
import { buildPiperArgs } from "./piper";

describe("buildPiperArgs", () => {
  it("constructs the expected argv", () => {
    const args = buildPiperArgs({
      modelPath: "/abs/assets/voices/en_US-ryan-high.onnx",
      outputPath: "/abs/output/x/audio.wav",
    });
    expect(args).toEqual(["--model", "/abs/assets/voices/en_US-ryan-high.onnx", "--output_file", "/abs/output/x/audio.wav"]);
  });
});
