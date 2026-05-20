import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { atOffset, newTitle } = (await req.json()) as { atOffset: number; newTitle: string };
  if (!Number.isInteger(atOffset) || atOffset < 1) {
    return NextResponse.json({ error: "atOffset must be a positive integer" }, { status: 400 });
  }
  if (typeof newTitle !== "string" || !newTitle.trim()) {
    return NextResponse.json({ error: "newTitle required" }, { status: 400 });
  }

  const me = await db.chapter.findUnique({ where: { id } });
  if (!me) return NextResponse.json({ error: "chapter not found" }, { status: 404 });
  if (atOffset >= me.rawText.length) {
    return NextResponse.json({ error: "atOffset past end of chapter" }, { status: 400 });
  }

  const left = me.rawText.slice(0, atOffset).trimEnd();
  const right = me.rawText.slice(atOffset).trimStart();

  await db.$transaction(async (tx) => {
    // Bump all chapters with orderIndex > me by +1
    await tx.chapter.updateMany({
      where: { bookId: me.bookId, orderIndex: { gt: me.orderIndex } },
      data: { orderIndex: { increment: 1 } },
    });
    await tx.chapter.update({
      where: { id },
      data: { rawText: left },
    });
    await tx.chapter.create({
      data: {
        bookId: me.bookId,
        title: newTitle.trim(),
        orderIndex: me.orderIndex + 1,
        startPage: me.startPage, // approximate; pages already overlap
        endPage: me.endPage,
        rawText: right,
        status: "pending",
      },
    });
  });

  return NextResponse.json({ ok: true });
}
