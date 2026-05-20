import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const suggestion = await db.suggestion.findUnique({ where: { id } });
  if (!suggestion) return NextResponse.json({ error: "suggestion not found" }, { status: 404 });
  if (suggestion.status !== "open") {
    return NextResponse.json({ error: `suggestion is ${suggestion.status}` }, { status: 409 });
  }

  await db.suggestion.update({
    where: { id },
    data: { status: "dismissed", resolvedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
