import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  await prisma.concept.delete({ where: { id: params.id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
