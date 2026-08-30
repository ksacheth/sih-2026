import { getDb } from "@/lib/models/db";
import { sha256, randomCode } from "@/lib/security/crypto";

const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export async function issueVerificationCode(
  userId: string,
  identifierId: string,
  destination: string
) {
  const code = randomCode();
  const db = await getDb();

  await db.collection("verification_codes").insertOne({
    userId,
    identifierId,
    codeHash: sha256(code),
    attempts: 0,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + TTL_MS),
  });

  const dev = process.env.NODE_ENV !== "production";
  if (dev) console.info(`[DEV VERIFICATION CODE] ${identifierId}: ${code}`);

  if (process.env.AUTH_RESEND_KEY && process.env.AUTH_RESEND_FROM) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.AUTH_RESEND_FROM,
        to: destination,
        subject: "Your exposure monitor verification code",
        text: `Your verification code is ${code}. It expires in 10 minutes.`,
      }),
    });
    if (!response.ok) throw new Error("VERIFICATION_DELIVERY_FAILED");
  }

  return dev ? code : undefined;
}

export async function verifyCode(userId: string, identifierId: string, code: string) {
  const db = await getDb();
  const record = await db.collection("verification_codes").findOne(
    { userId, identifierId },
    { sort: { createdAt: -1 } }
  );

  if (!record || record.expiresAt < new Date()) throw new Error("CODE_EXPIRED");
  if (record.attempts >= MAX_ATTEMPTS) throw new Error("TOO_MANY_ATTEMPTS");

  if (sha256(code) !== record.codeHash) {
    await db.collection("verification_codes").updateOne(
      { _id: record._id },
      { $inc: { attempts: 1 } }
    );
    throw new Error("INVALID_CODE");
  }

  await db.collection("identifiers").updateOne(
    { _id: identifierId, userId },
    { $set: { status: "VERIFIED", verifiedAt: new Date() } }
  );

  await db.collection("consents").insertOne({
    userId,
    identifierId,
    purpose: "EXPOSURE_MONITORING",
    scope: "scan_verified_identifier",
    version: "v1",
    createdAt: new Date(),
  });

  await db.collection("verification_codes").deleteMany({ userId, identifierId });
}