import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { setRenderConcurrency } from "@/lib/jobs/runner";

export const dynamic = "force-dynamic";

/**
 * Generic key/value Setting endpoint for the Phase 7 settings extensions
 * (background music, render concurrency, music gain, log level). The
 * canonical `default_voice` setting keeps its dedicated route — this is
 * additive.
 *
 * Allowlist keys + lightweight per-key validation so we don't end up with
 * arbitrary writable globals.
 */
const ALLOW = new Set([
  "enable_music",
  "render_concurrency",
  "music_gain_db",
  "log_level",
]);

function validate(key: string, value: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return { ok: false, error: "value must be string | number | boolean" };
  }
  const v = String(value);
  if (key === "enable_music") {
    if (v !== "true" && v !== "false") return { ok: false, error: "enable_music must be 'true' or 'false'" };
  } else if (key === "render_concurrency") {
    const n = Number.parseInt(v, 10);
    if (!Number.isFinite(n) || n < 1 || n > 4) return { ok: false, error: "render_concurrency must be 1–4" };
    return { ok: true, value: String(n) };
  } else if (key === "music_gain_db") {
    const n = Number.parseFloat(v);
    if (!Number.isFinite(n) || n > 0 || n < -40) return { ok: false, error: "music_gain_db must be in [-40, 0]" };
    return { ok: true, value: String(n) };
  } else if (key === "log_level") {
    if (!["debug", "info", "warn", "error"].includes(v)) {
      return { ok: false, error: "log_level must be debug|info|warn|error" };
    }
  }
  return { ok: true, value: v };
}

export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!ALLOW.has(key)) {
    return NextResponse.json({ error: `unknown setting key: ${key}` }, { status: 404 });
  }
  const row = await db.setting.findUnique({ where: { key } });
  return NextResponse.json({ key, value: row?.value ?? null });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!ALLOW.has(key)) {
    return NextResponse.json({ error: `unknown setting key: ${key}` }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }
  const rawValue =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).value
      : undefined;
  const v = validate(key, rawValue);
  if (!v.ok) {
    return NextResponse.json({ error: v.error }, { status: 400 });
  }
  const row = await db.setting.upsert({
    where: { key },
    update: { value: v.value },
    create: { key, value: v.value },
  });
  if (key === "render_concurrency") {
    setRenderConcurrency(Number.parseInt(v.value, 10));
  }
  return NextResponse.json({ key: row.key, value: row.value });
}
