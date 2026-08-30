import { NextResponse } from "next/server";
import { z } from "zod";
import { connectToDatabase } from "@/lib/db";
import { IdentifierModel } from "@/lib/models";
import { getSessionUserId } from "@/lib/security";

const input = z.object({ identifierIds: z.array(z.string()).min(1).max(10) });
export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  const parsed = input.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose at least one identifier." }, { status: 400 });
  await connectToDatabase();
  const identifiers = await IdentifierModel.find({ _id: { $in: parsed.data.identifierIds }, userId });
  if (identifiers.length !== parsed.data.identifierIds.length || identifiers.some((item) => item.status !== "VERIFIED" && item.status !== "ATTESTED")) return NextResponse.json({ error: "Every selected identifier must be verified or attested before scanning." }, { status: 400 });
  return NextResponse.json({ scanId: crypto.randomUUID(), status: "QUEUED", message: "Scan accepted." }, { status: 202 });
}
