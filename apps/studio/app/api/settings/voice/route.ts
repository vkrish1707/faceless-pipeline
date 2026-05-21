import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { DEFAULT_VOICE, VOICE_ALLOWLIST } from "@/lib/jobs/handlers/synthesize-script";

export const dynamic = "force-dynamic";

export async function GET() {
  let row = await db.setting.findUnique({ where: { key: "default_voice" } });
  if (!row) {
    row = await db.setting.upsert({
      where: { key: "default_voice" },
      update: {},
      create: { key: "default_voice", value: DEFAULT_VOICE },
    });
  }
  return NextResponse.json({ value: row.value });
}

export async function PATCH(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }
  const value = typeof body === "object" && body !== null ? (body as Record<string, unknown>).value : undefined;
  if (typeof value !== "string") {
    return NextResponse.json({ error: "value must be a string" }, { status: 400 });
  }
  if (!(VOICE_ALLOWLIST as readonly string[]).includes(value)) {
    return NextResponse.json(
      { error: `voice must be one of: ${VOICE_ALLOWLIST.join(", ")}` },
      { status: 400 }
    );
  }
  const row = await db.setting.upsert({
    where: { key: "default_voice" },
    update: { value },
    create: { key: "default_voice", value },
  });
  return NextResponse.json({ value: row.value });
}
