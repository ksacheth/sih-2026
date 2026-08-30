import { NextResponse } from "next/server";
import { z } from "zod";
import { connectToDatabase } from "@/lib/db";
import { IdentifierModel, VerificationCode } from "@/lib/models";
import { getSessionUserId, hash } from "@/lib/security";

const input = z.object({ code: z.string().regex(/^\d{6}$/) });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  const parsed = input.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter the 6-digit code." }, { status: 400 });
  await connectToDatabase();
  const identifier = await IdentifierModel.findOne({ _id: (await params).id, userId, type: "email", status: "PENDING" });
  if (!identifier) return NextResponse.json({ error: "Pending email identifier not found." }, { status: 404 });
  const code = await VerificationCode.findOneAndDelete({ identifierId: identifier._id, codeHash: hash(parsed.data.code), expiresAt: { $gt: new Date() } });
  if (!code) return NextResponse.json({ error: "That code is invalid or expired." }, { status: 400 });
  identifier.status = "VERIFIED";
  await identifier.save();
  return NextResponse.json({ identifier: { id: String(identifier._id), type: identifier.type, maskedValue: identifier.maskedValue, status: identifier.status } });
}
