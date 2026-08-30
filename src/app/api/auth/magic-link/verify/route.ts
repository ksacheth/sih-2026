import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { MagicLink, User } from "@/lib/models";
import { hash, sessionCookie, signSession } from "@/lib/security";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return NextResponse.redirect(new URL("/onboarding?error=invalid-link", request.url));
  await connectToDatabase();
  const record = await MagicLink.findOneAndDelete({ tokenHash: hash(token), expiresAt: { $gt: new Date() } });
  if (!record) return NextResponse.redirect(new URL("/onboarding?error=expired-link", request.url));
  const user = await User.findOneAndUpdate({ email: record.email }, { $setOnInsert: { email: record.email } }, { upsert: true, new: true });
  const response = NextResponse.redirect(new URL("/dashboard", request.url));
  response.cookies.set("privacy_lens_session", signSession(String(user._id)), sessionCookie());
  return response;
}
