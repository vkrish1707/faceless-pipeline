// Permissive shape so this helper works against both the real PrismaClient
// (whose Json types are not unknown but a complex InputJsonValue union) and
// the small test doubles we use in unit tests.
export type CacheClient = {
  trendSnapshot: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findUnique: (args: any) => Promise<{ data: unknown; fetchedAt: Date } | null>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    upsert: (args: any) => Promise<unknown>;
  };
};

export type CachedReadOpts<T> = {
  db: CacheClient;
  keyword: string;
  source: string;
  ttlMs?: number;
  now?: () => Date;
  fetcher: () => Promise<T | null>;
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export async function cachedTrendRead<T>(opts: CachedReadOpts<T>): Promise<{ data: T | null; hit: boolean }> {
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  const nowFn = opts.now ?? (() => new Date());
  const cur = nowFn();

  const existing = await opts.db.trendSnapshot.findUnique({
    where: { keyword_source: { keyword: opts.keyword, source: opts.source } },
  });
  if (existing && cur.getTime() - existing.fetchedAt.getTime() < ttl) {
    return { data: existing.data as T, hit: true };
  }

  const fresh = await opts.fetcher();
  if (fresh === null) {
    return { data: existing ? (existing.data as T) : null, hit: false };
  }

  await opts.db.trendSnapshot.upsert({
    where: { keyword_source: { keyword: opts.keyword, source: opts.source } },
    update: { data: fresh as unknown, fetchedAt: cur },
    create: { keyword: opts.keyword, source: opts.source, data: fresh as unknown, fetchedAt: cur },
  });
  return { data: fresh, hit: false };
}
