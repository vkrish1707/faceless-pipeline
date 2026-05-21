import { createHash } from "node:crypto";

export type PexelsMediaType = "photo" | "video";

export function cacheKey(mediaType: PexelsMediaType, query: string, perPage: number): string {
  const norm = `${mediaType}|${query.toLowerCase().trim()}|${perPage}`;
  return createHash("sha256").update(norm).digest("hex");
}

// Permissive shape so this helper works against the real PrismaClient and small test doubles.
export type CacheClient = {
  pexelsCache: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findUnique: (args: any) => Promise<{ results: unknown; fetchedAt: Date } | null>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    upsert: (args: any) => Promise<unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete?: (args: any) => Promise<unknown>;
  };
};

export type CachedPexelsOpts<T> = {
  db: CacheClient;
  key: string;
  ttlMs?: number;
  now?: () => Date;
  fetcher: () => Promise<T>;
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export async function cachedPexelsSearch<T>(
  opts: CachedPexelsOpts<T>
): Promise<{ data: T; hit: boolean }> {
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  const nowFn = opts.now ?? (() => new Date());
  const cur = nowFn();

  const existing = await opts.db.pexelsCache.findUnique({ where: { queryKey: opts.key } });
  if (existing && cur.getTime() - existing.fetchedAt.getTime() < ttl) {
    return { data: existing.results as T, hit: true };
  }

  const fresh = await opts.fetcher();
  await opts.db.pexelsCache.upsert({
    where: { queryKey: opts.key },
    update: { results: fresh as unknown, fetchedAt: cur },
    create: { queryKey: opts.key, results: fresh as unknown, fetchedAt: cur },
  });
  return { data: fresh, hit: false };
}
