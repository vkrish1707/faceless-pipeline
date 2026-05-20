import { describe, it, expect, vi, beforeEach } from "vitest";

function mockLib(impls: Array<() => Promise<string> | string | Promise<never>>) {
  const fn = vi.fn();
  for (const impl of impls) {
    fn.mockImplementationOnce(impl);
  }
  vi.doMock("google-trends-api", () => ({
    default: { interestOverTime: fn },
  }));
  return fn;
}

const GOOD = JSON.stringify({
  default: {
    timelineData: [
      { formattedAxisTime: "Mon", value: [10] },
      { formattedAxisTime: "Tue", value: [20] },
      { formattedAxisTime: "Wed", value: [60] },
      { formattedAxisTime: "Thu", value: [80] },
    ],
  },
});

describe("googleTrends", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("parses points and detects rising direction on happy path", async () => {
    mockLib([async () => GOOD]);
    const { googleTrends } = await import("./google");
    const out = await googleTrends({ keyword: "etf", maxAttempts: 1 });
    expect(out).not.toBeNull();
    expect(out!.points.length).toBe(4);
    expect(out!.direction).toBe("rising");
    expect(out!.avg).toBeGreaterThan(0);
  });

  it("retries on error then succeeds", async () => {
    const fn = mockLib([
      async () => {
        throw new Error("transient");
      },
      async () => GOOD,
    ]);
    const { googleTrends } = await import("./google");
    const out = await googleTrends({ keyword: "etf", maxAttempts: 2 });
    expect(out).not.toBeNull();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("returns null after exhausting retries", async () => {
    const warns: string[] = [];
    mockLib([
      async () => {
        throw new Error("x");
      },
      async () => {
        throw new Error("x");
      },
    ]);
    const { googleTrends } = await import("./google");
    const out = await googleTrends({
      keyword: "etf",
      maxAttempts: 2,
      logger: { warn: (m) => warns.push(m) },
    });
    expect(out).toBeNull();
    expect(warns.length).toBe(1);
  });

  it("returns null on unparseable JSON", async () => {
    mockLib([async () => "not json"]);
    const { googleTrends } = await import("./google");
    const out = await googleTrends({ keyword: "etf", maxAttempts: 1 });
    expect(out).toBeNull();
  });
});
