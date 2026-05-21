export type PexelsPhotoResult = {
  id: number;
  thumb: string;
  full: string;
  alt: string;
  width: number;
  height: number;
};

export type PexelsVideoResult = {
  id: number;
  thumb: string;
  full: string;
  width: number;
  height: number;
  durationSec: number;
};

type SearchOpts = {
  apiKey: string;
  perPage?: number;
  fetchImpl?: typeof fetch;
};

const RETRY_5XX_MS = [500, 1500];

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch
): Promise<Response> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= RETRY_5XX_MS.length; attempt++) {
    try {
      const res = await fetchImpl(url, init);
      if (res.status >= 500 && attempt < RETRY_5XX_MS.length) {
        await new Promise((r) => setTimeout(r, RETRY_5XX_MS[attempt]));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_5XX_MS.length) {
        await new Promise((r) => setTimeout(r, RETRY_5XX_MS[attempt]));
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("pexels fetch failed");
}

export async function searchPhotos(
  query: string,
  opts: SearchOpts
): Promise<PexelsPhotoResult[]> {
  const perPage = opts.perPage ?? 5;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=portrait&size=large`;
  const res = await fetchWithRetry(url, { headers: { Authorization: opts.apiKey } }, fetchImpl);
  if (!res.ok) {
    throw new Error(`Pexels ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    photos: Array<{
      id: number;
      width?: number;
      height?: number;
      src: { large: string; medium: string };
      alt?: string;
    }>;
  };
  return data.photos.map((p) => ({
    id: p.id,
    thumb: p.src.medium,
    full: p.src.large,
    alt: p.alt ?? "",
    width: p.width ?? 0,
    height: p.height ?? 0,
  }));
}

type PexelsVideoFile = {
  id?: number;
  quality?: string;
  file_type?: string;
  width?: number | null;
  height?: number | null;
  link: string;
};

type PexelsVideoRaw = {
  id: number;
  width: number;
  height: number;
  duration: number;
  image: string;
  video_files: PexelsVideoFile[];
};

export async function searchVideos(
  query: string,
  opts: SearchOpts
): Promise<PexelsVideoResult[]> {
  const perPage = opts.perPage ?? 5;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=portrait`;
  const res = await fetchWithRetry(url, { headers: { Authorization: opts.apiKey } }, fetchImpl);
  if (!res.ok) {
    throw new Error(`Pexels ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { videos: PexelsVideoRaw[] };
  return data.videos.map(normalizeVideo);
}

function normalizeVideo(v: PexelsVideoRaw): PexelsVideoResult {
  const files = (v.video_files ?? []).filter(
    (f): f is PexelsVideoFile & { width: number; height: number } =>
      typeof f.width === "number" && typeof f.height === "number"
  );

  // Pick the smallest video_file with height >= 1080 and width <= 1280.
  const qualified = files.filter((f) => f.height >= 1080 && f.width <= 1280);
  let pick: (PexelsVideoFile & { width: number; height: number }) | undefined;
  if (qualified.length > 0) {
    pick = qualified.reduce((a, b) => (a.width * a.height <= b.width * b.height ? a : b));
  } else if (files.length > 0) {
    // Fall back to closest match to (1080 height, 1280 width).
    pick = files.reduce((best, cur) => {
      const distCur = Math.abs(cur.height - 1080) + Math.abs(cur.width - 1280);
      const distBest = Math.abs(best.height - 1080) + Math.abs(best.width - 1280);
      return distCur < distBest ? cur : best;
    });
  }

  return {
    id: v.id,
    thumb: v.image,
    full: pick?.link ?? "",
    width: pick?.width ?? v.width,
    height: pick?.height ?? v.height,
    durationSec: v.duration,
  };
}
