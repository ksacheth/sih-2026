import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { getDb } from "@/lib/models/db";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  const { id } = await params;
  const db = await getDb();
  const scan = await db.collection("scans").findOne({ _id: id, userId: user.id });
  if (!scan) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(scan);
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  const { id } = await params;
  const db = await getDb();
  const result = await db.collection("scans").updateOne(
    { _id: id, userId: user.id, status: { $in: ["QUEUED", "RUNNING"] } },
    { $set: { cancelRequested: true } }
  );
  if (!result.matchedCount) return NextResponse.json({ error: "Not found or not cancellable" }, { status: 404 });
  return NextResponse.json({ ok: true });
}