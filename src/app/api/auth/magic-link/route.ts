import { NextResponse } from "next/server";
import { z } from "zod";
import { connectToDatabase } from "@/lib/db";
import { MagicLink } from "@/lib/models";
import { hash, randomToken } from "@/lib/security";
import { deliverEmail } from "@/lib/email";

const input = z.object({ email: z.string().email().max(254).transform((email) => email.toLowerCase()) });

export async function POST(request: Request) {
  const parsed = input.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  await connectToDatabase();
  const token = randomToken();
  await MagicLink.create({ email: parsed.data.email, tokenHash: hash(token), expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
  const origin = new URL(request.url).origin;
  const magicLink = `${origin}/api/auth/magic-link/verify?token=${token}`;
  await deliverEmail({ to: parsed.data.email, subject: "Your Privacy Lens sign-in link", text: `Open this secure link within 10 minutes: ${magicLink}` });
  return NextResponse.json({ message: "Magic link sent.", ...(process.env.NODE_ENV !== "production" ? { devMagicLink: magicLink } : {}) });
}
