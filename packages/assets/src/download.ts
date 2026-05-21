import { createHash } from "node:crypto";
import { promises as fs, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ALLOWED_EXTS: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

const MIN_BYTES = 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export type DownloadOpts = {
  url: string;
  destDir: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type DownloadResult = {
  localPath: string;
  bytes: number;
  contentType: string;
};

export async function downloadAsset(opts: DownloadOpts): Promise<DownloadResult> {
  const ext = extFromUrl(opts.url);
  const contentType = ALLOWED_EXTS[ext];
  if (!contentType) {
    throw new Error(`downloadAsset: disallowed extension ${ext || "(none)"} for ${opts.url}`);
  }
  const hash = createHash("sha256").update(opts.url).digest("hex");
  const localPath = resolve(opts.destDir, `${hash}${ext}`);

  if (existsSync(localPath)) {
    const stat = statSync(localPath);
    return { localPath, bytes: stat.size, contentType };
  }

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("download timeout")), timeoutMs);

  try {
    const res = await fetchImpl(opts.url, { signal: ac.signal });
    if (!res.ok) {
      throw new Error(`downloadAsset: HTTP ${res.status} for ${opts.url}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength <= MIN_BYTES) {
      throw new Error(`downloadAsset: too small (${buf.byteLength} bytes) for ${opts.url}`);
    }
    await fs.mkdir(dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, buf);
    return { localPath, bytes: buf.byteLength, contentType };
  } finally {
    clearTimeout(timer);
  }
}

function extFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const m = path.toLowerCase().match(/\.[a-z0-9]+$/);
    return m ? m[0] : "";
  } catch {
    const m = url.toLowerCase().match(/\.[a-z0-9]+$/);
    return m ? m[0] : "";
  }
}

export function contentTypeForExt(ext: string): string | undefined {
  return ALLOWED_EXTS[ext.toLowerCase()];
}
