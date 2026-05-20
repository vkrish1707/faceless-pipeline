import { describe, it, expect, vi } from "vitest";
import { cachedTrendRead } from "./cache";

function makeDb() {
  const store = new Map<string, { data: unknown; fetchedAt: Date }>();
  return {
    store,
    trendSnapshot: {
      findUnique: vi.fn(async ({ where }: { where: { keyword_source: { keyword: string; source: string } } }) => {
        return store.get(key(where.keyword_source)) ?? null;
      }),
      upsert: vi.fn(async ({ where, create }: {
        where: { keyword_source: { keyword: string; source: string } };
        create: { keyword: string; source: string; data: unknown; fetchedAt: Date };
      }) => {
        store.set(key(where.keyword_source), { data: create.data, fetchedAt: create.fetchedAt });
        return create;
      }),
    },
  };
}

const key = ({ keyword, source }: { keyword: string; source: string }) => `${keyword}::${source}`;

describe("cachedTrendRead", () => {
  it("returns cache hit when fresh within TTL", async () => {
    const db = makeDb();
    db.store.set("etf::google", { data: { avg: 50 }, fetchedAt: new Date("2026-05-20T00:00:00Z") });
    const fetcher = vi.fn(async () => ({ avg: 99 }));
    const out = await cachedTrendRead({
      db,
      keyword: "etf",
      source: "google",
      now: () => new Date("2026-05-20T05:00:00Z"),
      fetcher,
    });
    expect(out.hit).toBe(true);
    expect((out.data as { avg: number }).avg).toBe(50);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("re-fetches when TTL exceeded and upserts", async () => {
    const db = makeDb();
    db.store.set("etf::google", { data: { avg: 50 }, fetchedAt: new Date("2026-05-18T00:00:00Z") });
    const fetcher = vi.fn(async () => ({ avg: 70 }));
    const out = await cachedTrendRead({
      db,
      keyword: "etf",
      source: "google",
      now: () => new Date("2026-05-20T05:00:00Z"),
      fetcher,
    });
    expect(out.hit).toBe(false);
    expect((out.data as { avg: number }).avg).toBe(70);
    expect(db.trendSnapshot.upsert).toHaveBeenCalledTimes(1);
  });

  it("returns the stale snapshot if fetch returns null after TTL miss", async () => {
    const db = makeDb();
    db.store.set("etf::reddit", { data: { topUps: 10 }, fetchedAt: new Date("2026-05-18T00:00:00Z") });
    const fetcher = vi.fn(async () => null);
    const out = await cachedTrendRead({
      db,
      keyword: "etf",
      source: "reddit",
      now: () => new Date("2026-05-20T05:00:00Z"),
      fetcher,
    });
    expect(out.hit).toBe(false);
    expect((out.data as { topUps: number }).topUps).toBe(10);
    expect(db.trendSnapshot.upsert).not.toHaveBeenCalled();
  });

  it("returns null when no cache exists and fetcher returns null", async () => {
    const db = makeDb();
    const out = await cachedTrendRead({
      db,
      keyword: "etf",
      source: "reddit",
      fetcher: async () => null,
    });
    expect(out.data).toBeNull();
    expect(out.hit).toBe(false);
  });
});
