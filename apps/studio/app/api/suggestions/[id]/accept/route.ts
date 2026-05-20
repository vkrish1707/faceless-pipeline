import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { applySuggestion } from "@/lib/suggestions";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const suggestion = await db.suggestion.findUnique({ where: { id } });
  if (!suggestion) return NextResponse.json({ error: "suggestion not found" }, { status: 404 });
  if (suggestion.status !== "open") {
    return NextResponse.json({ error: `suggestion is ${suggestion.status}` }, { status: 409 });
  }

  try {
    await applySuggestion(suggestion);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("conflict:")) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true });
}
