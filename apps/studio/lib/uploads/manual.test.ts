import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateMime, writeUpload, sanitizeBasename } from "./manual";

function jpegBuffer(): Buffer {
  // 32 bytes: FF D8 FF E0 ...JFIF-ish header padding.
  const b = Buffer.alloc(32, 0);
  b[0] = 0xff;
  b[1] = 0xd8;
  b[2] = 0xff;
  b[3] = 0xe0;
  return b;
}

function pngBuffer(): Buffer {
  const b = Buffer.alloc(32, 0);
  b[0] = 0x89;
  b[1] = 0x50;
  b[2] = 0x4e;
  b[3] = 0x47;
  b[4] = 0x0d;
  b[5] = 0x0a;
  b[6] = 0x1a;
  b[7] = 0x0a;
  return b;
}

function webpBuffer(): Buffer {
  const b = Buffer.alloc(32, 0);
  b.write("RIFF", 0);
  b.writeUInt32LE(24, 4);
  b.write("WEBP", 8);
  b.write("VP8 ", 12);
  return b;
}

function mp4Buffer(brand = "isom"): Buffer {
  const b = Buffer.alloc(32, 0);
  b.writeUInt32BE(32, 0); // size
  b.write("ftyp", 4);
  b.write(brand, 8);
  return b;
}

function movBuffer(): Buffer {
  const b = Buffer.alloc(32, 0);
  b.writeUInt32BE(32, 0);
  b.write("ftyp", 4);
  b.write("qt  ", 8);
  return b;
}

describe("validateMime", () => {
  it("accepts a valid jpeg", () => {
    expect(validateMime(jpegBuffer(), "image/jpeg")).toEqual({ ok: true });
  });

  it("accepts a valid png", () => {
    expect(validateMime(pngBuffer(), "image/png")).toEqual({ ok: true });
  });

  it("accepts a valid webp", () => {
    expect(validateMime(webpBuffer(), "image/webp")).toEqual({ ok: true });
  });

  it("accepts a valid mp4", () => {
    expect(validateMime(mp4Buffer(), "video/mp4")).toEqual({ ok: true });
  });

  it("accepts a valid mov", () => {
    expect(validateMime(movBuffer(), "video/quicktime")).toEqual({ ok: true });
  });

  it("rejects mismatched magic bytes (jpeg declared, png bytes)", () => {
    const r = validateMime(pngBuffer(), "image/jpeg");
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/magic bytes/);
  });

  it("rejects unsupported declared mimes", () => {
    expect(validateMime(jpegBuffer(), "application/pdf").ok).toBe(false);
  });

  it("rejects an mp4-declared file that is actually a mov", () => {
    expect(validateMime(movBuffer(), "video/mp4").ok).toBe(false);
  });
});

describe("sanitizeBasename", () => {
  it("strips path separators", () => {
    expect(sanitizeBasename("/etc/passwd")).toBe("_etc_passwd");
    expect(sanitizeBasename("foo\\bar.jpg")).toBe("foo_bar.jpg");
  });

  it("collapses whitespace and trims", () => {
    expect(sanitizeBasename("  my photo.jpg  ")).toBe("my_photo.jpg");
  });

  it("defaults to 'upload' when empty", () => {
    expect(sanitizeBasename("///")).toBe("___");
    expect(sanitizeBasename("")).toBe("upload");
  });
});

describe("writeUpload", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "manual-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("writes a sanitized file under <root>/<scriptId>/<idx>-<basename>", async () => {
    const buf = jpegBuffer();
    const out = await writeUpload({
      scriptId: "s1",
      beatIndex: 2,
      basename: "../my secret.jpg",
      buffer: buf,
      declaredMime: "image/jpeg",
      rootDir: root,
    });
    expect(out.localPath).toBe(join(root, "s1", "2-.._my_secret.jpg"));
    expect(out.bytes).toBe(buf.byteLength);
    expect(existsSync(out.localPath)).toBe(true);
    expect(readFileSync(out.localPath).equals(buf)).toBe(true);
  });

  it("rejects when buffer larger than maxBytes", async () => {
    await expect(
      writeUpload({
        scriptId: "s1",
        beatIndex: 0,
        basename: "a.jpg",
        buffer: jpegBuffer(),
        declaredMime: "image/jpeg",
        rootDir: root,
        maxBytes: 8,
      })
    ).rejects.toThrow(/too large/);
  });

  it("rejects when magic bytes mismatch", async () => {
    await expect(
      writeUpload({
        scriptId: "s1",
        beatIndex: 0,
        basename: "a.jpg",
        buffer: pngBuffer(),
        declaredMime: "image/jpeg",
        rootDir: root,
      })
    ).rejects.toThrow(/invalid file/);
  });
});
