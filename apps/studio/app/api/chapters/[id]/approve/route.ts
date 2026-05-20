import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const chapter = await db.chapter.findUnique({ where: { id } });
  if (!chapter) return NextResponse.json({ error: "chapter not found" }, { status: 404 });

  let body: { ideaIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!Array.isArray(body.ideaIds) || !body.ideaIds.every((x) => typeof x === "string")) {
    return NextResponse.json({ error: "ideaIds must be string[]" }, { status: 400 });
  }
  const approvedIds = body.ideaIds as string[];

  await db.$transaction(async (tx) => {
    const all = await tx.idea.findMany({
      where: { chapterId: id, status: { in: ["scored", "approved"] } },
      select: { id: true },
    });
    const allIds = all.map((i) => i.id);
    const wantApproved = new Set(approvedIds.filter((i) => allIds.includes(i)));
    const toApprove = allIds.filter((i) => wantApproved.has(i));
    const toUnapprove = allIds.filter((i) => !wantApproved.has(i));
    if (toApprove.length > 0) {
      await tx.idea.updateMany({ where: { id: { in: toApprove } }, data: { status: "approved" } });
    }
    if (toUnapprove.length > 0) {
      await tx.idea.updateMany({ where: { id: { in: toUnapprove } }, data: { status: "scored" } });
    }
  });

  return NextResponse.json({ ok: true });
}
