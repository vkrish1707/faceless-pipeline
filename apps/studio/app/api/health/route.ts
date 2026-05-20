import { NextResponse } from "next/server";
import { runAllChecks } from "@/lib/deps";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await runAllChecks(process.env);
  return NextResponse.json(result);
}
