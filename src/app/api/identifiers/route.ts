import { NextResponse } from "next/server";
import { z } from "zod";
import { connectToDatabase } from "@/lib/db";
import { IdentifierModel, VerificationCode } from "@/lib/models";
import { getSessionUserId, hash, maskIdentifier } from "@/lib/security";
import { deliverEmail } from "@/lib/email";

const input = z.object({ type: z.enum(["email", "phone", "username"]), value: z.string().trim().min(2).max(254) });
const serialize = (item: { _id: unknown; type: "email" | "phone" | "username"; maskedValue: string; status: "PENDING" | "VERIFIED" | "ATTESTED" }) => ({ id: String(item._id), type: item.type, maskedValue: item.maskedValue, status: item.status });

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  await connectToDatabase();
  return NextResponse.json({ identifiers: (await IdentifierModel.find({ userId }).sort({ createdAt: -1 })).map(serialize) });
}

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  const parsed = input.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Provide a valid identifier." }, { status: 400 });
  const { type } = parsed.data;
  const value = type === "email" ? parsed.data.value.toLowerCase() : parsed.data.value;
  if (type === "email" && !z.string().email().safeParse(value).success) return NextResponse.json({ error: "Provide a valid email address." }, { status: 400 });
  await connectToDatabase();
  const hasVerifiedEmail = await IdentifierModel.exists({ userId, type: "email", status: "VERIFIED" });
  if (type === "phone" && !hasVerifiedEmail) return NextResponse.json({ error: "Verify an email before attesting a phone number." }, { status: 400 });
  try {
    const identifier = await IdentifierModel.create({ userId, type, valueHmac: hash(`${type}:${value}`), maskedValue: maskIdentifier(type, value), status: type === "phone" ? "ATTESTED" : "PENDING" });
    if (type !== "email") return NextResponse.json({ identifier: serialize(identifier) }, { status: 201 });
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await VerificationCode.deleteMany({ identifierId: identifier._id });
    await VerificationCode.create({ identifierId: identifier._id, codeHash: hash(code), expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
    await deliverEmail({ to: value, subject: "Your Privacy Lens verification code", text: `Your 6-digit identifier verification code is ${code}. It expires in 10 minutes.` });
    return NextResponse.json({ identifier: serialize(identifier), message: "Verification code sent. It expires in 10 minutes.", ...(process.env.NODE_ENV !== "production" ? { devCode: code } : {}) }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("duplicate key")) return NextResponse.json({ error: "This identifier is already added." }, { status: 409 });
    throw error;
  }
}
