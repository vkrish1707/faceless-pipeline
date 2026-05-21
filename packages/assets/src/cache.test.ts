import { describe, it, expect, vi } from "vitest";
import { cacheKey, cachedPexelsSearch } from "./cache";

function makeDb() {
  const store = new Map<string, { results: unknown; fetchedAt: Date }>();
  return {
    store,
    pexelsCache: {
      findUnique: vi.fn(async ({ where }: { where: { queryKey: string } }) => {
        return store.get(where.queryKey) ?? null;
      }),
      upsert: vi.fn(async ({ where, create }: {
        where: { queryKey: string };
        create: { queryKey: string; results: unknown; fetchedAt: Date };
      }) => {
        store.set(where.queryKey, { results: create.results, fetchedAt: create.fetchedAt });
        return create;
      }),
    },
  };
}

describe("cacheKey", () => {
  it("normalizes case and whitespace", () => {
    const a = cacheKey("photo", "Compound Interest", 5);
    const b = cacheKey("photo", "  compound interest  ", 5);
    expect(a).toBe(b);
  });

  it("changes when mediaType, query, or perPage changes", () => {
    const base = cacheKey("photo", "x", 5);
    expect(cacheKey("video", "x", 5)).not.toBe(base);
    expect(cacheKey("photo", "y", 5)).not.toBe(base);
    expect(cacheKey("photo", "x", 6)).not.toBe(base);
  });

  it("returns a sha256 hex string", () => {
    expect(cacheKey("photo", "x", 5)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("cachedPexelsSearch", () => {
  it("hits cache within TTL", async () => {
    const db = makeDb();
    db.store.set("k1", { results: [{ id: 1 }], fetchedAt: new Date("2026-05-20T00:00:00Z") });
    const fetcher = vi.fn(async () => [{ id: 99 }]);
    const out = await cachedPexelsSearch({
      db,
      key: "k1",
      now: () => new Date("2026-05-20T05:00:00Z"),
      fetcher,
    });
    expect(out.hit).toBe(true);
    expect(out.data).toEqual([{ id: 1 }]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("re-fetches and upserts past TTL", async () => {
    const db = makeDb();
    db.store.set("k1", { results: [{ id: 1 }], fetchedAt: new Date("2026-05-18T00:00:00Z") });
    const fetcher = vi.fn(async () => [{ id: 2 }]);
    const out = await cachedPexelsSearch({
      db,
      key: "k1",
      now: () => new Date("2026-05-20T05:00:00Z"),
      fetcher,
    });
    expect(out.hit).toBe(false);
    expect(out.data).toEqual([{ id: 2 }]);
    expect(db.pexelsCache.upsert).toHaveBeenCalledTimes(1);
  });

  it("fetches and upserts on cold miss", async () => {
    const db = makeDb();
    const fetcher = vi.fn(async () => [{ id: 3 }]);
    const out = await cachedPexelsSearch({ db, key: "k1", fetcher });
    expect(out.hit).toBe(false);
    expect(out.data).toEqual([{ id: 3 }]);
    expect(db.pexelsCache.upsert).toHaveBeenCalledTimes(1);
  });
});
