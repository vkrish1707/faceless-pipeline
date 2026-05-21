import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { downloadAsset } from "./download";

describe("downloadAsset", () => {
  let dest: string;

  beforeEach(() => {
    dest = mkdtempSync(join(tmpdir(), "dl-"));
  });

  afterEach(() => {
    rmSync(dest, { recursive: true, force: true });
  });

  it("writes file to <destDir>/<sha256(url)><ext> and returns metadata", async () => {
    const url = "https://example.com/path/photo.jpg";
    const expectedHash = createHash("sha256").update(url).digest("hex");
    const buf = Buffer.alloc(4096, 7);
    const fetchImpl = vi.fn(async () => new Response(buf, { status: 200 }));

    const out = await downloadAsset({ url, destDir: dest, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.localPath).toBe(join(dest, `${expectedHash}.jpg`));
    expect(out.bytes).toBe(4096);
    expect(out.contentType).toBe("image/jpeg");
    expect(existsSync(out.localPath)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("skips download if hashed file already exists", async () => {
    const url = "https://example.com/x.png";
    const hash = createHash("sha256").update(url).digest("hex");
    const target = join(dest, `${hash}.png`);
    writeFileSync(target, Buffer.alloc(3000, 1));
    const fetchImpl = vi.fn(async () => {
      throw new Error("should not be called");
    });
    const out = await downloadAsset({ url, destDir: dest, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.localPath).toBe(target);
    expect(out.bytes).toBe(3000);
    expect(out.contentType).toBe("image/png");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects when downloaded bytes <= 1024", async () => {
    const fetchImpl = vi.fn(async () => new Response(Buffer.alloc(512), { status: 200 }));
    await expect(
      downloadAsset({
        url: "https://example.com/y.jpg",
        destDir: dest,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toThrow(/too small/);
  });

  it("rejects disallowed extensions", async () => {
    await expect(
      downloadAsset({
        url: "https://example.com/evil.exe",
        destDir: dest,
        fetchImpl: vi.fn() as unknown as typeof fetch,
      })
    ).rejects.toThrow(/disallowed extension/);
  });

  it("rejects on non-2xx HTTP response", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 404 }));
    await expect(
      downloadAsset({
        url: "https://example.com/x.jpg",
        destDir: dest,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toThrow(/HTTP 404/);
  });

  it("handles webp, mp4, mov extensions", async () => {
    const buf = Buffer.alloc(2048, 9);
    const ok = (n: string) => async () => new Response(buf, { status: 200 });
    const a = await downloadAsset({
      url: "https://e.com/a.webp",
      destDir: dest,
      fetchImpl: ok("a") as unknown as typeof fetch,
    });
    expect(a.contentType).toBe("image/webp");
    const b = await downloadAsset({
      url: "https://e.com/b.mp4",
      destDir: dest,
      fetchImpl: ok("b") as unknown as typeof fetch,
    });
    expect(b.contentType).toBe("video/mp4");
    const c = await downloadAsset({
      url: "https://e.com/c.mov",
      destDir: dest,
      fetchImpl: ok("c") as unknown as typeof fetch,
    });
    expect(c.contentType).toBe("video/quicktime");
  });
});
