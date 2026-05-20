import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

async function renumber(bookId: string) {
  const chapters = await db.chapter.findMany({ where: { bookId }, orderBy: { orderIndex: "asc" } });
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i]!.orderIndex !== i) {
      await db.chapter.update({ where: { id: chapters[i]!.id }, data: { orderIndex: i } });
    }
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  // Merge with next?
  if (body.mergeWithNext === true) {
    const me = await db.chapter.findUniqueOrThrow({ where: { id } });
    const next = await db.chapter.findFirst({
      where: { bookId: me.bookId, orderIndex: { gt: me.orderIndex } },
      orderBy: { orderIndex: "asc" },
    });
    if (!next) return NextResponse.json({ error: "no next chapter to merge with" }, { status: 400 });
    await db.$transaction(async (tx) => {
      await tx.chapter.update({
        where: { id },
        data: {
          rawText: `${me.rawText}\n\n${next.rawText}`,
          endPage: next.endPage,
        },
      });
      await tx.idea.deleteMany({ where: { chapterId: next.id } });
      await tx.chapter.delete({ where: { id: next.id } });
    });
    await renumber(me.bookId);
    return NextResponse.json({ ok: true });
  }

  // Plain rename
  if (typeof body.title === "string") {
    const trimmed = body.title.trim();
    if (!trimmed) return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
    await db.chapter.update({ where: { id }, data: { title: trimmed } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "no recognized fields in body" }, { status: 400 });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await db.chapter.findUniqueOrThrow({ where: { id } });
  await db.$transaction(async (tx) => {
    await tx.idea.deleteMany({ where: { chapterId: id } });
    await tx.chapter.delete({ where: { id } });
  });
  await renumber(me.bookId);
  return NextResponse.json({ ok: true });
}
