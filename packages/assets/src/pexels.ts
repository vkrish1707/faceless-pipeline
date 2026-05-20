export type PexelsPhotoResult = {
  id: number;
  thumb: string;
  full: string;
  alt: string;
};

export async function searchPhotos(
  query: string,
  opts: { apiKey: string; perPage?: number }
): Promise<PexelsPhotoResult[]> {
  const perPage = opts.perPage ?? 5;
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}`;
  const res = await fetch(url, { headers: { Authorization: opts.apiKey } });
  if (!res.ok) {
    throw new Error(`Pexels ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { photos: Array<{ id: number; src: { large: string; medium: string }; alt?: string }> };
  return data.photos.map((p) => ({
    id: p.id,
    thumb: p.src.medium,
    full: p.src.large,
    alt: p.alt ?? "",
  }));
}
