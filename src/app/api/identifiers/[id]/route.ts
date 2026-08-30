import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { IdentifierModel, VerificationCode } from "@/lib/models";
import { getSessionUserId } from "@/lib/security";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  await connectToDatabase();
  const identifier = await IdentifierModel.findOneAndDelete({ _id: (await params).id, userId });
  if (!identifier) return NextResponse.json({ error: "Identifier not found." }, { status: 404 });
  await VerificationCode.deleteMany({ identifierId: identifier._id });
  return new NextResponse(null, { status: 204 });
}
