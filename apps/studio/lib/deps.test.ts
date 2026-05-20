import { describe, it, expect } from "vitest";
import { checkBinary, summarize } from "./deps";

describe("checkBinary", () => {
  it("returns ok when which finds the binary", async () => {
    const res = await checkBinary("sh");
    expect(res.ok).toBe(true);
    expect(res.path?.length).toBeGreaterThan(0);
  });

  it("returns not ok when binary missing", async () => {
    const res = await checkBinary("definitely-not-a-real-binary-xyz123");
    expect(res.ok).toBe(false);
  });
});

describe("summarize", () => {
  it("returns ok when every entry is ok", () => {
    expect(summarize([{ name: "a", ok: true }, { name: "b", ok: true }])).toBe("ok");
  });
  it("returns degraded when some failures", () => {
    expect(summarize([{ name: "a", ok: true }, { name: "b", ok: false }])).toBe("degraded");
  });
});
